const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookHandler } = require('../src/services/webhookProcessor');

function makeHandler({ transaction, fulfill, refund, event }) {
  const state = { status: transaction.status, calls: 0, refundCalls: 0 };
  const db = {
    rpc: async () => ({ data: { claimed: true, processing_token: 'lease' }, error: null }),
    from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { event_id: 'evt_1' }, error: null }) }) }) }) }) }) }),
  };
  const handler = createWebhookHandler({
    db,
    verify: () => event || ({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', status: 'succeeded', amount_received: 1050, currency: 'eur', metadata: { user_id: 'buyer' } } } }),
    getTransaction: async () => ({ ...transaction, status: state.status }),
    fulfill: async () => { state.calls++; return fulfill(state); },
    refund: async () => { state.refundCalls++; return refund(); },
    markStatus: async (_intent, next) => { state.status = next; return { status: next }; },
    updateAccount: async () => {},
  });
  return { handler, state };
}

test('a paid resale whose ticket is unavailable is refunded once and marked refunded', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'created' },
    fulfill: state => { state.status = 'refund_pending'; return { refund_required: true }; },
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
    fulfill: state => { state.status = 'refund_pending'; return { refund_required: true }; },
    refund: () => { throw new Error('Stripe unavailable'); },
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 500);
  assert.equal(state.status, 'refund_pending');
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

test('a resale database outage does not trigger a refund without a durable decision', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'created' },
    fulfill: () => { throw new Error('Database unavailable'); },
    refund: () => ({ status: 'succeeded' }),
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 500);
  assert.equal(state.refundCalls, 0);
  assert.equal(state.status, 'created');
});

test('a persisted pending refund is resumed after a crash before contacting Stripe', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'refund_pending' },
    fulfill: () => ({ refund_required: true, status: 'refund_pending' }),
    refund: () => ({ status: 'succeeded' }),
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 200);
  assert.equal(state.refundCalls, 1);
  assert.equal(state.status, 'refunded');
});

test('a lost RPC response after ticket transfer does not refund the buyer', async () => {
  let state;
  const flow = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'created' },
    fulfill: () => { state.status = 'fulfilled'; throw new Error('response lost'); },
    refund: () => ({ status: 'succeeded' }),
  });
  state = flow.state;
  assert.equal((await flow.handler(Buffer.from('{}'), 'signature')).status, 500);
  assert.equal(state.status, 'fulfilled');
  assert.equal(state.refundCalls, 0);
});

test('Stripe refund failure stays visible for reconciliation', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'refund_pending' },
    event: { id: 'evt_refund', type: 'refund.failed', data: { object: { id: 're_1', payment_intent: 'pi_1', status: 'failed', metadata: { eclipse_reason: 'resale_unavailable' } } } },
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 200);
  assert.equal(state.status, 'refund_failed');
});

test('a delayed pending refund event cannot overwrite refund failure', async () => {
  const { handler, state } = makeHandler({
    transaction: { kind: 'resale_ticket', user_id: 'buyer', amount_cents: 1050, currency: 'eur', status: 'refund_failed' },
    event: { id: 'evt_refund', type: 'refund.updated', data: { object: { id: 're_1', payment_intent: 'pi_1', status: 'pending', metadata: { eclipse_reason: 'resale_unavailable' } } } },
  });
  assert.equal((await handler(Buffer.from('{}'), 'signature')).status, 200);
  assert.equal(state.status, 'refund_failed');
});
