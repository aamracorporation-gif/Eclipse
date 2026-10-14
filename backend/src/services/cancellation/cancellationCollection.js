'use strict';
const { randomUUID } = require('node:crypto');
const { checked, failure, idOf } = require('./organizerBilling');
const { POLICY_VERSION, calculateCancellationAmounts } = require('./cancellationAmounts');

function calculateCollection(refunds, evidence) {
  if (!evidence?.reference || evidence.feesFinalized !== true || !Array.isArray(evidence.purchases)) {
    throw failure('FINAL_FEE_RECONCILIATION_REQUIRED');
  }
  if (refunds.some(r => !['succeeded','not_paid'].includes(r.status))) throw failure('BUYER_REFUNDS_NOT_COMPLETE');
  const paid = refunds.filter(r => r.status === 'succeeded');
  const unique = new Set(); let commission = 0, costs = 0;
  if (paid.length !== evidence.purchases.length) throw failure('RECONCILIATION_PURCHASE_COUNT_MISMATCH');
  for (const refund of paid) {
    const matches = evidence.purchases.filter(p => p.transactionId === refund.transaction_id);
    if (matches.length !== 1) throw failure('RECONCILIATION_PURCHASE_MISMATCH');
    for (const cost of matches[0].costs || []) {
      if (unique.has(cost.reference)) throw failure('DUPLICATE_STRIPE_FEE');
      unique.add(cost.reference);
    }
    const amount = calculateCancellationAmounts({ chargedCents: refund.amount_cents,
      ticketPriceCents: refund.amount_cents - refund.service_charge_cents, serviceChargeCents: refund.service_charge_cents,
      eclipseCommissionCents: refund.commission_cents, currency: 'eur', costs: matches[0].costs, feesFinalized: true });
    commission += amount.eclipseCommissionCents; costs += amount.stripeCostsCents;
  }
  if (!Number.isSafeInteger(commission + costs)) throw failure('COLLECTION_OVERFLOW');
  return { commission, costs, total: commission + costs };
}

function createCancellationCollection({ db, stripe, livemode, now = () => Date.now() }) {
  // Internal accounting boundary. Never expose this method to organizer input.
  // Evidence must be reconciled with Stripe's itemized fee records; an inline
  // balance_transaction alone cannot certify that standalone fees are final.
  async function prepare(jobId, evidence) {
    const job = await checked(db.from('event_cancellations').select('*').eq('id', jobId).single());
    if (job.livemode !== livemode || job.status !== 'reconciliation') throw failure('CANCELLATION_NOT_RECONCILED');
    const refunds = [];
    for (let offset = 0; ; offset += 500) {
      const page = await checked(db.from('cancellation_refunds').select('*').eq('cancellation_id', jobId).order('transaction_id').range(offset, offset + 499));
      refunds.push(...page); if (page.length < 500) break;
    }
    const amounts = calculateCollection(refunds, evidence);
    if (!amounts.total) return { noCharge: true };
    // UNIQUE cancellation_id freezes one initial collection even across retries.
    await checked(db.from('cancellation_collections').upsert({ id: randomUUID(), cancellation_id: jobId,
      amount_cents: amounts.total, commission_cents: amounts.commission, stripe_costs_cents: amounts.costs,
      cost_evidence: evidence, reconciliation_reference: evidence.reference },
    { onConflict: 'cancellation_id', ignoreDuplicates: true }));
    await checked(db.from('event_cancellations').update({ status: 'collection_pending' }).eq('id', jobId));
    return checked(db.from('cancellation_collections').select('*').eq('cancellation_id', jobId).single());
  }
  async function owned(id, userId) {
    const row = await checked(db.from('cancellation_collections').select('*,event_cancellations!inner(organizer_id,livemode,policy_version)')
      .eq('id', id).eq('event_cancellations.organizer_id', userId).maybeSingle());
    if (!row || row.event_cancellations.livemode !== livemode) throw failure('COLLECTION_NOT_FOUND', 404);
    return row;
  }
  async function collect(id, userId, onSession = false) {
    let row = await owned(id, userId);
    const billing = await checked(db.from('organizer_billing_accounts').select('*').eq('organizer_id', userId).single());
    if (!billing.ready || billing.livemode !== livemode || billing.policy_version !== POLICY_VERSION || !billing.payment_method_id) {
      throw failure('BILLING_AUTHORIZATION_REQUIRED');
    }
    if (!row.notice_delivered_at) throw failure('COLLECTION_NOTICE_REQUIRED');
    let intent;
    if (row.payment_intent_id) intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
    else {
      // Recover a successful Stripe request whose response/database write was lost.
      const prior = await stripe.paymentIntents.list({ customer: billing.stripe_customer_id, limit: 100 })
        .autoPagingToArray({ limit: 1000 });
      const matches = prior.filter(p => p.metadata?.eclipse_collection_id === row.id);
      if (matches.length > 1) throw failure('MULTIPLE_COLLECTIONS_REQUIRE_REVIEW');
      intent = matches[0];
      if (!intent) {
        if (row.first_attempt_at && now() - Date.parse(row.first_attempt_at) > 23 * 3600000) {
          throw failure('UNCERTAIN_COLLECTION_REQUIRES_REVIEW');
        }
        if (!row.first_attempt_at) {
          await checked(db.from('cancellation_collections').update({ first_attempt_at: new Date(now()).toISOString() })
            .eq('id', row.id).is('first_attempt_at', null));
        }
        const params = { amount: row.amount_cents, currency: 'eur', customer: billing.stripe_customer_id,
          payment_method: billing.payment_method_id, automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          description: 'Eclipse: comisión y costes de cancelación',
          metadata: { eclipse_purpose: 'organizer_cancellation_collection', eclipse_collection_id: row.id,
            eclipse_cancellation_id: row.cancellation_id, eclipse_organizer_id: userId },
          confirm: true, off_session: true };
        // Always create the same PI with the same parameters. On-session recovery
        // confirms this existing PI, never creates a second debt/charge.
        try { intent = await stripe.paymentIntents.create(params, { idempotencyKey: `cancel-collection:${row.id}` }); }
        catch (e) { if (e.payment_intent?.id) intent = await stripe.paymentIntents.retrieve(e.payment_intent.id); else throw e; }
      }
    }
    if (intent.livemode !== livemode || intent.amount !== row.amount_cents || intent.currency !== 'eur' ||
      idOf(intent.customer) !== billing.stripe_customer_id || intent.metadata?.eclipse_collection_id !== row.id ||
      (intent.status === 'succeeded' && intent.amount_received !== row.amount_cents)) throw failure('COLLECTION_PAYMENT_MISMATCH');
    const status = ['succeeded','requires_action','requires_payment_method'].includes(intent.status) ? intent.status : 'processing';
    await checked(db.from('cancellation_collections').update({ payment_intent_id: intent.id, status }).eq('id', row.id));
    await checked(db.from('event_cancellations').update({ status: status === 'succeeded' ? 'collected' : 'requires_action' }).eq('id', row.cancellation_id));
    // Collection fees are not zero and are not included retroactively in this PI.
    // Keep residual_costs_status=pending for separate reconciliation, no microcharge loop.
    return { status, ...(onSession && ['requires_action','requires_payment_method'].includes(status) ? { clientSecret: intent.client_secret } : {}) };
  }
  async function acknowledgeAndCollect(id, userId) {
    await owned(id, userId);
    await checked(db.from('cancellation_collections').update({ notice_delivered_at: new Date(now()).toISOString() })
      .eq('id', id).is('notice_delivered_at', null));
    return collect(id, userId, true);
  }
  return { prepare, collect, acknowledgeAndCollect };
}
module.exports = { createCancellationCollection, calculateCollection };
