'use strict';
const { checked, failure, idOf } = require('./organizerBilling');

function validateSettlement(event, tx, intent, livemode, now = Date.now()) {
  // No inferred five-hour duration for payouts. Operations must verify actual completion.
  if (!event.end_datetime || !Number.isFinite(Date.parse(event.end_datetime)) || Date.parse(event.end_datetime) > now ||
    event.is_cancelled || event.status === 'cancelled') throw failure('EVENT_NOT_COMPLETED');
  if (tx.status !== 'fulfilled' || tx.metadata?.settlement_model !== 'after_event_v1' ||
    tx.metadata.event_id !== event.id || tx.currency !== 'eur' ||
    !Number.isSafeInteger(tx.destination_amount_cents) || tx.destination_amount_cents <= 0 ||
    tx.destination_amount_cents > tx.amount_cents || !/^acct_/.test(tx.destination_account_id || '')) throw failure('SETTLEMENT_NOT_ELIGIBLE');
  if (intent.id !== tx.stripe_payment_intent_id || intent.status !== 'succeeded' || intent.livemode !== livemode ||
    intent.amount_received !== tx.amount_cents || intent.currency !== tx.currency || intent.transfer_data ||
    intent.metadata?.event_id !== event.id || intent.metadata?.settlement_model !== 'after_event_v1' ||
    !intent.latest_charge || intent.latest_charge.refunded || intent.latest_charge.amount_refunded > 0 ||
    intent.latest_charge.disputed) throw failure('STRIPE_SETTLEMENT_MISMATCH');
}
function createOrganizerSettlement({ db, stripe, livemode, now = () => Date.now() }) {
  // Internal operation after an administrator verifies that the event took place.
  // There is intentionally no organizer-accessible payout endpoint.
  async function release(transactionId, { eventCompletionVerified = false, execute = false } = {}) {
    const tx = await checked(db.from('payment_transactions').select('*').eq('id', transactionId).single());
    const event = await checked(db.from('events').select('id,creator_id,status,is_cancelled,end_datetime').eq('id', tx.metadata?.event_id).single());
    const intent = await stripe.paymentIntents.retrieve(tx.stripe_payment_intent_id, { expand: ['latest_charge'] });
    validateSettlement(event, tx, intent, livemode, now());
    for (let offset = 0; ; offset += 500) {
      const entries = await checked(db.from('organizer_cost_entries').select('id,notice_delivered_at').eq('organizer_id', event.creator_id)
        .eq('livemode', livemode).order('id').range(offset, offset + 499));
      for (const entry of entries) if (!entry.notice_delivered_at) await checked(db.rpc('refresh_organizer_cost_notice', { p_id: entry.id }));
      if (entries.length < 500) break;
    }
    if (execute && !eventCompletionVerified) throw failure('EVENT_COMPLETION_VERIFICATION_REQUIRED');
    const row = await checked(db.rpc('reserve_organizer_settlement', { p_transaction: tx.id, p_livemode: livemode,
      p_verified: eventCompletionVerified, p_execute: execute }));
    const quote = { amountCents: row.amount_cents, grossAmountCents: row.gross_amount_cents,
      costAdjustmentCents: row.cost_adjustment_cents, currency: tx.currency, destination: row.destination_account_id };
    if (!execute) return quote;
    if (row.livemode !== livemode || row.gross_amount_cents !== tx.destination_amount_cents || row.destination_account_id !== tx.destination_account_id ||
      row.amount_cents !== row.gross_amount_cents-row.cost_adjustment_cents || row.amount_cents<0 || row.amount_cents>tx.amount_cents) throw failure('SETTLEMENT_SNAPSHOT_MISMATCH');
    if (row.amount_cents === 0) {
      await checked(db.from('organizer_settlement_transfers').update({ status: 'offset' }).eq('transaction_id', tx.id));
      return { ...quote, settledByOffset: true };
    }
    let transfer = row.transfer_id ? await stripe.transfers.retrieve(row.transfer_id) : null;
    if (!transfer) {
      const transfers = await stripe.transfers.list({ transfer_group: `event_${event.id}`, limit: 100 }).autoPagingToArray({ limit: 10000 });
      const matches = transfers.filter(t => t.metadata?.eclipse_transaction_id === tx.id);
      if (matches.length > 1) throw failure('DUPLICATE_SETTLEMENT_REQUIRES_REVIEW');
      transfer = matches[0];
      if (!transfer) {
        if (row.first_attempt_at && now() - Date.parse(row.first_attempt_at) > 23 * 3600000) throw failure('UNCERTAIN_SETTLEMENT_REQUIRES_REVIEW');
        await checked(db.from('organizer_settlement_transfers').update({ first_attempt_at: row.first_attempt_at || new Date(now()).toISOString() })
          .eq('transaction_id', tx.id).is('first_attempt_at', null));
        transfer = await stripe.transfers.create({ amount: row.amount_cents, currency: tx.currency,
          destination: tx.destination_account_id, source_transaction: intent.latest_charge.id, transfer_group: `event_${event.id}`,
          metadata: { eclipse_transaction_id: tx.id, eclipse_event_id: event.id } }, { idempotencyKey: `event-settlement:${tx.id}` });
      }
    }
    if (transfer.livemode !== livemode || transfer.amount !== row.amount_cents || transfer.currency !== tx.currency ||
      idOf(transfer.destination) !== row.destination_account_id || transfer.reversed) throw failure('TRANSFER_MISMATCH');
    await checked(db.from('organizer_settlement_transfers').update({ transfer_id: transfer.id, status: 'transferred' }).eq('transaction_id', tx.id));
    return { ...quote, transferId: transfer.id };
  }
  return { release };
}
module.exports = { createOrganizerSettlement, validateSettlement };
