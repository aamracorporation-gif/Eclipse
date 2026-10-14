'use strict';
const { checked, failure, idOf } = require('./organizerBilling');
const { inlineStripeFeeEvidence } = require('./cancellationAmounts');

function saleSnapshot(tx) {
  const service = Number(tx.metadata?.service_fee_cents ?? 0);
  const commission = tx.platform_fee_cents;
  if (!['event_ticket','vip_table'].includes(tx.kind) || tx.currency !== 'eur' ||
    Number(tx.metadata?.credit_debit_cents || tx.metadata?.wallet_debit_cents || 0) !== 0 ||
    !Number.isSafeInteger(tx.amount_cents) || tx.amount_cents <= 0 ||
    !Number.isSafeInteger(service) || service < 0 || service > tx.amount_cents ||
    !Number.isSafeInteger(commission) || commission < 0 || commission > tx.amount_cents - service) {
    throw failure('PURCHASE_REQUIRES_MANUAL_RECONCILIATION');
  }
  if (tx.metadata?.eclipse_commission_cents !== undefined && Number(tx.metadata.eclipse_commission_cents) !== commission) {
    throw failure('COMMISSION_SNAPSHOT_MISMATCH');
  }
  return { service, commission };
}

// Independent of collection: no saved-card failure can suspend buyer refunds.
function createCancellationWorker({ db, stripe, livemode }) {
  async function saveRefund(id, patch) {
    return checked(db.from('cancellation_refunds').update({ ...patch, updated_at: new Date().toISOString() }).eq('transaction_id', id));
  }
  async function refundPurchase(job, tx, row) {
    const intent = await stripe.paymentIntents.retrieve(tx.stripe_payment_intent_id, { expand: ['latest_charge.balance_transaction'] });
    if (intent.livemode !== livemode || intent.currency !== tx.currency || intent.amount !== tx.amount_cents ||
      intent.metadata?.event_id !== job.event_id || intent.metadata?.user_id !== tx.user_id) throw failure('STRIPE_PAYMENT_MISMATCH');
    if (intent.status !== 'succeeded') {
      if (['requires_payment_method','requires_confirmation','requires_action'].includes(intent.status)) {
        // A concurrently completed payment makes cancellation fail and is retried as paid.
        await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `cancel-unpaid:${job.id}:${tx.id}` });
        await saveRefund(tx.id, { status: 'not_paid' });
      } else if (intent.status === 'canceled') await saveRefund(tx.id, { status: 'not_paid' });
      return;
    }
    if (intent.amount_received !== tx.amount_cents) throw failure('STRIPE_RECEIVED_AMOUNT_MISMATCH');
    // Trigger the existing buyer refund-processing notice only after Stripe
    // confirms a real paid purchase, and before issuing its refund.
    await checked(db.from('payment_transactions').update({ status: 'refund_pending' }).eq('id', tx.id).neq('status', 'refunded'));
    const all = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 }).autoPagingToArray({ limit: 1000 });
    // Include successful partial refunds from any source. Never refund the full amount twice.
    const active = all.filter(r => !['failed','canceled'].includes(r.status));
    const covered = active.reduce((total, r) => total + r.amount, 0);
    if (!Number.isSafeInteger(covered) || covered > tx.amount_cents) throw failure('REFUND_AMOUNT_MISMATCH');
    let own = active.find(r => r.metadata?.eclipse_cancellation_id === job.id);
    if (covered < tx.amount_cents) {
      if (all.some(r => ['failed','canceled'].includes(r.status) && r.metadata?.eclipse_cancellation_id === job.id)) {
        throw failure('FAILED_REFUND_REQUIRES_REVIEW');
      }
      const params = { payment_intent: intent.id, amount: tx.amount_cents - covered,
        metadata: { eclipse_reason: 'organizer_cancellation', eclipse_cancellation_id: job.id, eclipse_transaction_id: tx.id } };
      if (intent.transfer_data?.destination) {
        params.reverse_transfer = true;
        if (intent.application_fee_amount) params.refund_application_fee = true;
      }
      own = await stripe.refunds.create(params, { idempotencyKey: `event-cancel-refund:${job.id}:${tx.id}:${covered}` });
      active.push(own);
    }
    const successful = active.filter(r => r.status === 'succeeded').reduce((total, r) => total + r.amount, 0);
    let evidence = null;
    try { evidence = inlineStripeFeeEvidence(intent, { paymentIntentId: intent.id, chargedCents: tx.amount_cents, currency: tx.currency, livemode }); }
    catch (e) { if (e.code !== 'STRIPE_FEE_PENDING') throw e; }
    const status = successful === tx.amount_cents ? 'succeeded' : 'processing';
    await saveRefund(tx.id, { refund_id: own?.id || row.refund_id || null, status, fee_evidence: evidence, last_error: null });
    if (status === 'succeeded') {
      await checked(db.from('payment_transactions').update({ status: 'refunded' }).eq('id', tx.id));
    }
  }
  async function run(id) {
    const job = await checked(db.rpc('claim_event_cancellation', { p_id: id }));
    if (!job) return { busy: true };
    let error = null;
    try {
      if (job.livemode !== livemode) throw failure('CANCELLATION_MODE_MISMATCH');
      const event = await checked(db.from('events').select('id,creator_id,is_cancelled,status').eq('id', job.event_id).single());
      if (!event.is_cancelled || event.status !== 'cancelled' || event.creator_id !== job.organizer_id) throw failure('CANCELLATION_EVENT_MISMATCH');
      // Existing cancellation notification triggers record ticket history and queue notices.
      await checked(db.from('tickets').update({ status: 'cancelled', ticket_status: 'invalidated' })
        .eq('event_id', job.event_id).neq('ticket_status', 'invalidated'));
      // Discover late payments on every pass, even after a previous pass completed.
      for (let offset = 0; ; offset += 500) {
        const transactions = await checked(db.from('payment_transactions').select('*')
          .eq('protected_event_id', job.event_id).order('id').range(offset, offset + 499));
        for (const tx of transactions) {
          let snapshot;
          try { snapshot = saleSnapshot(tx); }
          catch (e) {
            await checked(db.from('cancellation_refunds').upsert({ transaction_id: tx.id, cancellation_id: job.id,
              payment_intent_id: tx.stripe_payment_intent_id, amount_cents: tx.amount_cents, commission_cents: 0,
              service_charge_cents: 0, status: 'attention', last_error: e.code || 'MANUAL_RECONCILIATION' },
            { onConflict: 'transaction_id', ignoreDuplicates: true }));
            error = 'PURCHASE_REQUIRES_MANUAL_RECONCILIATION';
            continue; // One unsupported historical purchase must not block other buyers.
          }
          await checked(db.from('cancellation_refunds').upsert({ transaction_id: tx.id, cancellation_id: job.id,
            payment_intent_id: tx.stripe_payment_intent_id, amount_cents: tx.amount_cents,
            commission_cents: snapshot.commission, service_charge_cents: snapshot.service },
          { onConflict: 'transaction_id', ignoreDuplicates: true }));
        }
        if (transactions.length < 500) break;
      }
      const pending = await checked(db.from('cancellation_refunds').select('*').eq('cancellation_id', job.id)
        .in('status', ['pending','processing']).order('updated_at').limit(20));
      for (const row of pending) {
        try {
          const tx = await checked(db.from('payment_transactions').select('*').eq('id', row.transaction_id).single());
          await refundPurchase(job, tx, row);
        } catch (e) {
          // Network failures stay retryable. Failed transfers/refunds remain visible for support.
          await saveRefund(row.transaction_id, { last_error: e.code || 'REFUND_RETRY_REQUIRED' });
          error = e.code || 'REFUND_RETRY_REQUIRED';
        }
      }
      const states = [];
      for (let offset = 0; ; offset += 500) {
        const page = await checked(db.from('cancellation_refunds').select('transaction_id,status').eq('cancellation_id', job.id)
          .order('transaction_id').range(offset, offset + 499));
        states.push(...page); if (page.length < 500) break;
      }
      const refundsFinished = states.every(r => ['succeeded','not_paid'].includes(r.status));
      if (['refunding','reconciliation','attention'].includes(job.status)) {
        await checked(db.from('event_cancellations').update({ status: refundsFinished ? (states.every(r => r.status === 'not_paid') ? 'collected' : 'reconciliation') : 'refunding' })
          .eq('id', id).eq('lease_token', job.lease_token));
      }
      return { refundsFinished, error };
    } catch (e) { error = e.code || 'CANCELLATION_RETRY_REQUIRED'; throw e; }
    finally {
      await checked(db.from('event_cancellations').update({ last_error: error, checked_at: new Date().toISOString(), lease_until: null })
        .eq('id', id).eq('lease_token', job.lease_token));
    }
  }
  async function handleWebhook(event) {
    const object = event.data.object;
    if (event.type.startsWith('payment_intent.') && object.metadata?.eclipse_purpose === 'organizer_cancellation_collection') {
      const row = await checked(db.from('cancellation_collections').select('*,event_cancellations!inner(organizer_id,livemode)')
        .eq('id', object.metadata.eclipse_collection_id).maybeSingle());
      if (!row || row.event_cancellations.livemode !== object.livemode || object.livemode !== livemode ||
        object.currency !== 'eur' || object.amount !== row.amount_cents ||
        (row.payment_intent_id && row.payment_intent_id !== object.id)) throw failure('COLLECTION_MISMATCH');
      const billing = await checked(db.from('organizer_billing_accounts').select('*').eq('organizer_id', row.event_cancellations.organizer_id).single());
      if (idOf(object.customer) !== billing.stripe_customer_id) throw failure('COLLECTION_CUSTOMER_MISMATCH');
      // Retrieve current state: out-of-order failure events cannot undo success.
      const current = await stripe.paymentIntents.retrieve(object.id, { expand: ['latest_charge.balance_transaction'] });
      if (current.status === 'succeeded' && current.amount_received !== row.amount_cents) throw failure('COLLECTION_RECEIVED_MISMATCH');
      const status = ['succeeded','requires_action','requires_payment_method'].includes(current.status) ? current.status : 'processing';
      let collectionFee = null;
      if (status === 'succeeded') {
        try { collectionFee = { ...inlineStripeFeeEvidence(current, { paymentIntentId: current.id, chargedCents: row.amount_cents, currency: 'eur', livemode }), category: 'collection' }; }
        catch (e) { if (e.code !== 'STRIPE_FEE_PENDING') throw e; }
      }
      await checked(db.from('cancellation_collections').update({ payment_intent_id: current.id, status,
        ...(collectionFee ? { collection_fee_evidence: collectionFee } : {}) }).eq('id', row.id));
      await checked(db.from('event_cancellations').update({ status: status === 'succeeded' ? 'collected' : 'requires_action' }).eq('id', row.cancellation_id));
      return true;
    }
    if (event.type.startsWith('refund.') && object.metadata?.eclipse_reason === 'organizer_cancellation') return true; // Worker retrieves authoritative state.
    if (event.type.startsWith('payment_intent.') && object.metadata?.event_id) {
      const job = await checked(db.from('event_cancellations').select('id').eq('event_id', object.metadata.event_id).maybeSingle());
      if (job) return true; // Worker discovers and refunds late successful payments.
    }
    return false;
  }
  return { run, refundPurchase, handleWebhook };
}
module.exports = { createCancellationWorker, saleSnapshot };
