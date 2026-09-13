function isDuplicateProcessed(existing) {
  return existing?.processing_status === 'processed';
}

function statusAfterStripeEvent(currentStatus, eventType) {
  if (['fulfilled', 'refunded', 'canceled', 'cancelled'].includes(currentStatus)) return currentStatus;
  if (eventType === 'payment_intent.payment_failed') return 'failed';
  return currentStatus;
}

module.exports = { isDuplicateProcessed, statusAfterStripeEvent };
