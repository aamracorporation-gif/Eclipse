const test = require('node:test');
const assert = require('node:assert/strict');
const { isDuplicateProcessed, statusAfterStripeEvent } = require('../src/services/webhookPolicy');

test('a processed Stripe event is ignored when delivered twice', () => {
  assert.equal(isDuplicateProcessed({ processing_status: 'processed' }), true);
  assert.equal(isDuplicateProcessed({ processing_status: 'failed' }), false);
});

test('a delayed failure cannot undo a fulfilled payment', () => {
  assert.equal(statusAfterStripeEvent('fulfilled', 'payment_intent.payment_failed'), 'fulfilled');
  assert.equal(statusAfterStripeEvent('refund_pending', 'payment_intent.payment_failed'), 'refund_pending');
  assert.equal(statusAfterStripeEvent('refunded', 'payment_intent.payment_failed'), 'refunded');
});

test('an out-of-order failure may mark only an unfulfilled payment failed', () => {
  assert.equal(statusAfterStripeEvent('created', 'payment_intent.payment_failed'), 'failed');
});
