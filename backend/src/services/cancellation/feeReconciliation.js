'use strict';
const { createHash } = require('node:crypto');
const { failure, checked, idOf } = require('./organizerBilling');
const { netProviderCosts } = require('./cancellationAmounts');
const { calculateCollection } = require('./cancellationCollection');

// Parse amounts without binary floating-point or silent rounding of currencies.
function decimalCents(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim());
  if (!match) throw failure('INVALID_REPORT_AMOUNT');
  const amount = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw failure('REPORT_AMOUNT_OVERFLOW');
  return match[1] ? -amount : amount;
}
function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw failure('INVALID_REPORT_CSV');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(r => r.some(Boolean));
}

/** Import the COMPLETE itemized fee export as a replacement snapshot. Never add
 * inline BT fees to the report: the same fee can appear in both. No client API
 * accepts this evidence. The accountant attests coverage, account and finality.
 * Reports with pending/missing fees must not be attested as complete. */
function importFeeReport(csv, manifest) {
  if (!manifest?.reference || !/^acct_/.test(manifest.stripeAccount || '') || typeof manifest.livemode !== 'boolean' ||
      manifest.currency !== 'eur' || manifest.feesFinalized !== true || !Array.isArray(manifest.targets) || !manifest.targets.length ||
      !manifest.reviewedBy || !Number.isFinite(Date.parse(manifest.reviewedAt))) throw failure('REVIEWED_REPORT_MANIFEST_REQUIRED');
  const rows = csvRows(csv), header = rows.shift() || [];
  if (new Set(header).size !== header.length || ['incurred_by','amount','tax','currency'].some(k => !header.includes(k))) throw failure('REPORT_COLUMNS_MISSING');
  const digest = createHash('sha256').update(csv).digest('hex');
  const targets = new Map();
  for (const target of manifest.targets) {
    if (!['processing','refund','collection'].includes(target.category) || !/^(ch|re|pi|txn)_/.test(target.providerId || '') || targets.has(target.providerId)) throw failure('INVALID_REPORT_TARGET');
    targets.set(target.providerId, { ...target, costs: [] });
  }
  const stableIds = new Set();
  rows.forEach((row, index) => {
    if (row.length !== header.length) throw failure('INVALID_REPORT_ROW');
    const fields = Object.fromEntries(header.map((k, i) => [k, row[i]]));
    const target = targets.get(fields.incurred_by);
    if (!target) return;
    if (fields.account_id && fields.account_id !== manifest.stripeAccount) throw failure('REPORT_ACCOUNT_MISMATCH');
    if (fields.currency.toLowerCase() !== 'eur') throw failure('REPORT_CURRENCY_MISMATCH');
    const signed = decimalCents(fields.amount) + decimalCents(fields.tax);
    if (!Number.isSafeInteger(signed)) throw failure('REPORT_AMOUNT_OVERFLOW');
    const stable = fields.fee_transaction_id || fields.id;
    if (stable && stableIds.has(stable)) throw failure('DUPLICATE_REPORT_FEE');
    if (stable) stableIds.add(stable);
    target.costs.push({ reference: stable ? `stripe-fee:${stable}` : `stripe-report:${digest}:${index + 2}`,
      amountCents: Math.abs(signed), direction: signed < 0 ? 'credit' : 'debit', currency: 'eur', category: target.category,
      incurredBy: fields.incurred_by, description: fields.fee_description || '' });
  });
  // A zero fee needs an explicit reviewed zero declaration, never an absent row.
  for (const target of targets.values()) {
    if (!target.costs.length && target.confirmedZero !== true) throw failure('REPORT_TARGET_FEES_MISSING');
  }
  return { ...manifest, sha256: digest, targets: [...targets.values()] };
}

async function reconcileCollectionFees({ db, stripe, livemode }, id, evidence) {
  if (!evidence?.sha256 || evidence.livemode !== livemode || evidence.feesFinalized !== true || !Array.isArray(evidence.targets)) throw failure('FINAL_FEE_REPORT_REQUIRED');
  const row = await checked(db.from('cancellation_collections').select('*,event_cancellations!inner(organizer_id,livemode)').eq('id', id).single());
  if (!['succeeded','deferred'].includes(row.status) || row.event_cancellations.livemode !== livemode) throw failure('COLLECTION_NOT_PAID');
  const account = await stripe.accounts.retrieve();
  if (account.id !== evidence.stripeAccount) throw failure('REPORT_ACCOUNT_MISMATCH');
  const refunds = [];
  for (let offset = 0; ; offset += 500) {
    const page = await checked(db.from('cancellation_refunds').select('*').eq('cancellation_id', row.cancellation_id).order('transaction_id').range(offset, offset + 499));
    refunds.push(...page); if (page.length < 500) break;
  }
  const allowed = new Map(), purchases = [];
  for (const refund of refunds.filter(r => r.status === 'succeeded')) {
    const intent = await stripe.paymentIntents.retrieve(refund.payment_intent_id, { expand: ['latest_charge'] });
    if (intent.livemode !== livemode || intent.status !== 'succeeded' || intent.amount_received !== refund.amount_cents || intent.currency !== 'eur') throw failure('REPORT_PAYMENT_MISMATCH');
    const chargeId = idOf(intent.latest_charge); if (!chargeId) throw failure('REPORT_CHARGE_MISSING');
    allowed.set(chargeId, { transactionId: refund.transaction_id, category: 'processing' });
    const all = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 }).autoPagingToArray({ limit: 1000 });
    if (all.some(r => !['succeeded','failed','canceled'].includes(r.status)) || all.filter(r => r.status === 'succeeded').reduce((sum,r)=>sum+r.amount,0) !== refund.amount_cents) throw failure('BUYER_REFUNDS_NOT_COMPLETE');
    for (const r of all.filter(r => r.status === 'succeeded')) allowed.set(r.id, { transactionId: refund.transaction_id, category: 'refund' });
    purchases.push({ transactionId: refund.transaction_id, costs: [] });
  }
  if (row.status !== 'deferred') {
    const collection = await stripe.paymentIntents.retrieve(row.payment_intent_id, { expand: ['latest_charge'] });
    if (collection.livemode !== livemode || collection.status !== 'succeeded' || collection.amount_received !== row.amount_cents || collection.currency !== 'eur' ||
        collection.metadata?.eclipse_collection_id !== id || !idOf(collection.latest_charge) || collection.latest_charge?.amount_refunded || collection.latest_charge?.disputed) throw failure('COLLECTION_PAYMENT_MISMATCH');
    allowed.set(idOf(collection.latest_charge), { category: 'collection' });
  } else if (row.payment_intent_id || row.amount_cents >= 50) throw failure('INVALID_DEFERRED_COLLECTION');
  const collectionCosts = [], used = new Set(), feeIds = new Set();
  for (const target of evidence.targets) {
    const match = allowed.get(target.providerId);
    if (!match || match.category !== target.category || used.has(target.providerId)) throw failure('REPORT_SCOPE_MISMATCH');
    used.add(target.providerId);
    if (!Array.isArray(target.costs) || (!target.costs.length && target.confirmedZero !== true)) throw failure('REPORT_TARGET_FEES_MISSING');
    for (const cost of target.costs) {
      if (cost.incurredBy !== target.providerId || cost.category !== target.category || feeIds.has(cost.reference)) throw failure('REPORT_FEE_MISMATCH');
      feeIds.add(cost.reference);
    }
    (match.category === 'collection' ? collectionCosts : purchases.find(p => p.transactionId === match.transactionId).costs).push(...target.costs);
  }
  if (used.size !== allowed.size) throw failure('INCOMPLETE_REPORT_SCOPE');
  const initial = calculateCollection(refunds, { reference: evidence.reference, feesFinalized: true, purchases });
  const collectionFee = netProviderCosts({ costs: collectionCosts, currency: 'eur', feesFinalized: true });
  const actualTotalCosts = initial.costs + collectionFee;
  if (!Number.isSafeInteger(actualTotalCosts) || actualTotalCosts > 2147483647) throw failure('REPORT_AMOUNT_OVERFLOW');
  if (initial.commission !== row.commission_cents) throw failure('COMMISSION_SNAPSHOT_MISMATCH');
  return checked(db.rpc('reconcile_cancellation_costs', { p_collection: id, p_livemode: livemode,
    p_total_costs: actualTotalCosts, p_collection_costs: collectionFee, p_reference: evidence.reference,
    p_sha256: evidence.sha256, p_evidence: evidence }));
}
module.exports = { decimalCents, csvRows, importFeeReport, reconcileCollectionFees };
