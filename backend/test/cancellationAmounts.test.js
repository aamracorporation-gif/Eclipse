const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCancellationAmounts: calculate, inlineStripeFeeEvidence } = require('../src/services/cancellation/cancellationAmounts');

const expense = (amountCents = 56, overrides = {}) => ({
  reference: 'txn_processing', category: 'processing', direction: 'debit', amountCents, currency: 'eur', ...overrides,
});
const purchase = (overrides = {}) => ({
  chargedCents: 2056, ticketPriceCents: 2000, serviceChargeCents: 56, eclipseCommissionCents: 200,
  currency: 'eur', costs: [expense()], feesFinalized: true, ...overrides,
});
const rejects = (args, code) => assert.throws(() => calculate(purchase(args)), error => error.code === code);

test('full buyer refund preserves the agreed commission only when organizer covers commission plus actual costs', () => {
  const out = calculate(purchase());
  assert.equal(out.customerRefundTotalCents, 2056);
  assert.equal(out.customerRefundRemainingCents, 2056);
  assert.equal(out.organizerOriginalAllocationCents, 1800);
  assert.equal(out.organizerCancellationLiabilityCents, 256);
  // Full cash conservation: payment + organizer coverage - fees - buyer refund.
  assert.equal(2056 + out.organizerCancellationLiabilityCents - out.stripeCostsCents - out.customerRefundTotalCents, 200);
});

test('uses actual Stripe costs, not the buyer service fee or application fee', () => {
  const out = calculate(purchase({ costs: [expense(92)] }));
  assert.equal(out.stripeCostsCents, 92);
  assert.equal(out.organizerCancellationLiabilityCents, 292);
  assert.equal(out.customerRefundTotalCents, 2056);
});

test('includes actual refund and collection expenses once, net of credits', () => {
  const out = calculate(purchase({ costs: [expense(), expense(12, { reference: 'txn_refund', category: 'refund' }),
    expense(9, { reference: 'txn_collection', category: 'collection' }),
    expense(6, { reference: 'txn_credit', direction: 'credit' })] }));
  assert.equal(out.stripeCostsCents, 71);
  assert.equal(out.organizerCancellationLiabilityCents, 271);
});

test('subtracts existing refunds and organizer collections without double charging', () => {
  const out = calculate(purchase({ alreadyRefundedCents: 1000, organizerCostsAlreadyCollectedCents: 250 }));
  assert.equal(out.customerRefundRemainingCents, 1056);
  assert.equal(out.organizerCollectionRemainingCents, 6);
  const overpaid = calculate(purchase({ alreadyRefundedCents: 2056, organizerCostsAlreadyCollectedCents: 300 }));
  assert.equal(overpaid.customerRefundRemainingCents, 0);
  assert.equal(overpaid.organizerCollectionRemainingCents, 0);
  assert.equal(overpaid.organizerOverpaymentCents, 44);
});

test('preserves historical discounted/VIP commission rather than recomputing a rate', () => {
  const out = calculate(purchase({ chargedCents: 31091, ticketPriceCents: 30600,
    serviceChargeCents: 491, eclipseCommissionCents: 1530, costs: [expense(610)] }));
  assert.equal(out.customerRefundTotalCents, 31091);
  assert.equal(out.organizerOriginalAllocationCents, 29070);
  assert.equal(out.organizerCancellationLiabilityCents, 2140);
});

test('unknown fees cannot become a definitive zero-cost quote', () => {
  rejects({ feesFinalized: false }, 'STRIPE_FEES_NOT_FINALIZED');
  rejects({ costs: null }, 'STRIPE_FEE_EVIDENCE_REQUIRED');
});

test('rejects mismatched currencies, duplicate records, malformed money and inconsistent purchase totals', () => {
  rejects({ currency: 'usd' }, 'UNSUPPORTED_CURRENCY');
  rejects({ costs: [expense(56, { currency: 'usd' })] }, 'STRIPE_FEE_CURRENCY_MISMATCH');
  rejects({ costs: [expense(), expense()] }, 'DUPLICATE_STRIPE_FEE');
  rejects({ costs: [expense(56, { category: 'application_fee' })] }, 'UNSUPPORTED_STRIPE_FEE_CATEGORY');
  rejects({ eclipseCommissionCents: 200.5 }, 'INVALID_ECLIPSE_COMMISSION');
  rejects({ chargedCents: Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_CHARGED_AMOUNT');
  rejects({ serviceChargeCents: 55 }, 'PURCHASE_BREAKDOWN_MISMATCH');
  rejects({ eclipseCommissionCents: 2100 }, 'COMMISSION_EXCEEDS_TICKET_PRICE');
  rejects({ alreadyRefundedCents: 3000 }, 'REFUNDS_EXCEED_PURCHASE');
  rejects({ costs: [expense(100, { direction: 'credit' })] }, 'STRIPE_FEE_CREDITS_EXCEED_DEBITS');
});

const expected = { paymentIntentId: 'pi_example', chargedCents: 2056, currency: 'eur', livemode: false };
const intent = () => ({ id: 'pi_example', amount_received: 2056, currency: 'eur', status: 'succeeded', livemode: false,
  application_fee_amount: 256, latest_charge: { id: 'ch_example', payment_intent: 'pi_example', paid: true,
    captured: true, amount: 2056, currency: 'eur', livemode: false,
    balance_transaction: { id: 'txn_example', source: 'ch_example', amount: 2056, currency: 'eur', type: 'charge', fee: 56 } } });

test('reads the Stripe balance transaction fee and explicitly keeps reconciliation open', () => {
  const fee = inlineStripeFeeEvidence(intent(), expected);
  assert.equal(fee.amountCents, 56);
  assert.equal(fee.feesFinalized, false);
  assert.equal(fee.reference, 'txn_example');
});

test('missing or unexpanded Stripe fee evidence remains pending', () => {
  for (const value of [null, 'txn_example']) {
    const pi = intent(); pi.latest_charge.balance_transaction = value;
    assert.throws(() => inlineStripeFeeEvidence(pi, expected), error => error.code === 'STRIPE_FEE_PENDING');
  }
});

test('cannot use another payment, test/live mode, currency or charge as cost evidence', () => {
  for (const patch of [{ id: 'pi_other' }, { livemode: true }, { currency: 'usd' }, { amount_received: 2000 }]) {
    assert.throws(() => inlineStripeFeeEvidence({ ...intent(), ...patch }, expected), error => error.code === 'STRIPE_PAYMENT_MISMATCH');
  }
  const pi = intent(); pi.latest_charge.balance_transaction.source = 'ch_other';
  assert.throws(() => inlineStripeFeeEvidence(pi, expected), error => error.code === 'STRIPE_BALANCE_TRANSACTION_MISMATCH');
});
