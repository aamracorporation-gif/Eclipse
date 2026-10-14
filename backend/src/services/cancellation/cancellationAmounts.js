'use strict';

const POLICY_VERSION = 'organizer-cancellation-full-refund-v1';

class CancellationCalculationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = 409;
  }
}

function cents(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new CancellationCalculationError(`INVALID_${name}`);
  return value;
}

function sum(values) {
  return cents(values.reduce((total, value) => total + value, 0), 'TOTAL');
}

// The service charge paid by the buyer is not evidence of a Stripe expense.
// Costs must come from provider records, with a durable ID for deduplication.
function netProviderCosts({ costs, currency, feesFinalized }) {
  if (feesFinalized !== true) throw new CancellationCalculationError('STRIPE_FEES_NOT_FINALIZED');
  if (!Array.isArray(costs)) throw new CancellationCalculationError('STRIPE_FEE_EVIDENCE_REQUIRED');
  const seen = new Set();
  const debits = [], credits = [];
  for (const cost of costs) {
    if (!cost || typeof cost.reference !== 'string' || !cost.reference.trim()) {
      throw new CancellationCalculationError('STRIPE_FEE_REFERENCE_REQUIRED');
    }
    if (seen.has(cost.reference)) throw new CancellationCalculationError('DUPLICATE_STRIPE_FEE');
    seen.add(cost.reference);
    if (cost.currency !== currency) throw new CancellationCalculationError('STRIPE_FEE_CURRENCY_MISMATCH');
    if (!['processing', 'refund', 'collection'].includes(cost.category)) {
      throw new CancellationCalculationError('UNSUPPORTED_STRIPE_FEE_CATEGORY');
    }
    cents(cost.amountCents, 'STRIPE_FEE');
    if (cost.direction === 'debit') debits.push(cost.amountCents);
    else if (cost.direction === 'credit') credits.push(cost.amountCents);
    else throw new CancellationCalculationError('INVALID_STRIPE_FEE_DIRECTION');
  }
  const charged = sum(debits), recovered = sum(credits);
  if (recovered > charged) throw new CancellationCalculationError('STRIPE_FEE_CREDITS_EXCEED_DEBITS');
  return charged - recovered;
}

/**
 * Full cancellation only. Money is always integer EUR cents. The original
 * commission is a sale snapshot, never recalculated at today's commission rate.
 * This calculation neither moves money nor proves that organizer debt was paid.
 */
function calculateCancellationAmounts({
  chargedCents, ticketPriceCents, serviceChargeCents, eclipseCommissionCents,
  alreadyRefundedCents = 0, organizerCostsAlreadyCollectedCents = 0,
  currency, costs, feesFinalized,
}) {
  if (currency !== 'eur') throw new CancellationCalculationError('UNSUPPORTED_CURRENCY');
  cents(chargedCents, 'CHARGED_AMOUNT');
  cents(ticketPriceCents, 'TICKET_PRICE');
  cents(serviceChargeCents, 'SERVICE_CHARGE');
  cents(eclipseCommissionCents, 'ECLIPSE_COMMISSION');
  cents(alreadyRefundedCents, 'ALREADY_REFUNDED');
  cents(organizerCostsAlreadyCollectedCents, 'ALREADY_COLLECTED');
  if (chargedCents !== sum([ticketPriceCents, serviceChargeCents])) {
    throw new CancellationCalculationError('PURCHASE_BREAKDOWN_MISMATCH');
  }
  if (eclipseCommissionCents > ticketPriceCents) {
    throw new CancellationCalculationError('COMMISSION_EXCEEDS_TICKET_PRICE');
  }
  if (alreadyRefundedCents > chargedCents) {
    throw new CancellationCalculationError('REFUNDS_EXCEED_PURCHASE');
  }
  const stripeCostsCents = netProviderCosts({ costs, currency, feesFinalized });
  const organizerCancellationLiabilityCents = sum([eclipseCommissionCents, stripeCostsCents]);
  return {
    policyVersion: POLICY_VERSION,
    currency,
    customerRefundTotalCents: chargedCents,
    customerRefundRemainingCents: chargedCents - alreadyRefundedCents,
    organizerOriginalAllocationCents: ticketPriceCents - eclipseCommissionCents,
    eclipseCommissionCents,
    stripeCostsCents,
    organizerCancellationLiabilityCents,
    organizerCollectionRemainingCents: Math.max(0, organizerCancellationLiabilityCents - organizerCostsAlreadyCollectedCents),
    organizerOverpaymentCents: Math.max(0, organizerCostsAlreadyCollectedCents - organizerCancellationLiabilityCents),
  };
}

/**
 * Reads the actual inline charge fee. This alone is NOT a final reconciliation:
 * Stripe can also bill standalone fees later. A null balance transaction is
 * pending information, never evidence of a zero processing fee.
 */
function inlineStripeFeeEvidence(paymentIntent, expected) {
  if (!paymentIntent || paymentIntent.id !== expected.paymentIntentId ||
      paymentIntent.status !== 'succeeded' || paymentIntent.livemode !== expected.livemode ||
      paymentIntent.currency !== expected.currency || paymentIntent.amount_received !== expected.chargedCents) {
    throw new CancellationCalculationError('STRIPE_PAYMENT_MISMATCH');
  }
  const charge = paymentIntent.latest_charge;
  if (!charge || typeof charge !== 'object' || !charge.id || charge.payment_intent !== paymentIntent.id ||
      charge.paid !== true || charge.captured !== true || charge.currency !== expected.currency ||
      charge.amount !== expected.chargedCents || charge.livemode !== expected.livemode) {
    throw new CancellationCalculationError('STRIPE_CHARGE_MISMATCH');
  }
  const transaction = charge.balance_transaction;
  if (!transaction || typeof transaction !== 'object') {
    throw new CancellationCalculationError('STRIPE_FEE_PENDING');
  }
  if (!transaction.id || transaction.source !== charge.id || transaction.currency !== expected.currency ||
      transaction.amount !== expected.chargedCents || transaction.type !== 'charge') {
    throw new CancellationCalculationError('STRIPE_BALANCE_TRANSACTION_MISMATCH');
  }
  cents(transaction.fee, 'STRIPE_FEE');
  return {
    reference: transaction.id,
    category: 'processing',
    direction: 'debit',
    amountCents: transaction.fee,
    currency: transaction.currency,
    chargeId: charge.id,
    feesFinalized: false,
  };
}

module.exports = {
  POLICY_VERSION, CancellationCalculationError, calculateCancellationAmounts, inlineStripeFeeEvidence,
};
