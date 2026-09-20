const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookHandler } = require('../src/services/webhookProcessor');

function makeHandler({ transaction, fulfill, refund }) {
  const state = { status: transaction.status, calls: 0, refundCalls: 0 };
  const db = {
    rpc: async () => ({ data: { claimed: true, processing_token: 'lease' }, error: null }),
    from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { event_id: 'evt_1' }, error: null }) }) }) }) }) }) }),
  };
  const handler = createWebhookHandler({
    db,
    verify: () => ({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', status: 'succeeded', amount_received: 1050, currency: 'eur', metadata: { user_id: 'buyer' } } } }),
    getTransaction: async () => ({ ...transaction, status: state.status }),
    fulfill: async () => { state.calls++; return fulfill(); },
    refund: async () => { state.refundCalls++; return refund(); },
    markStatus: async (_intent, next) => { state.status = next; return { status: next }; },
    updateAccount: async () => {},
  });
  return { handler, state };
}

test('a paid resale whose ticket is unavailable is refunded once and marked refunded', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'created' },
    fulfill: () => { throw new Error('Listing not active'); },
    refund: () => ({ status: 'succeeded' }),
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 200);
  assert.equal(state.status, 'refunded');
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 200);
  assert.equal(state.calls, 1);
  assert.equal(state.refundCalls, 1);
});

test('refund failure retries the Stripe webhook rather than acknowledging an unresolved charge', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'created' },
    fulfill: () => { throw new Error('Listing not active'); },
    refund: () => { throw new Error('Stripe unavailable'); },
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 500);
  assert.equal(state.status, 'created');
});

test('failed fulfillment outside resale does not issue a refund', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'event_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'created' },
    fulfill: () => { throw new Error('Temporary outage'); },
    refund: () => ({ status: 'succeeded' }),
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 500);
  assert.equal(state.refundCalls, 0);
});
