const test = require('node:test');
const assert = require('node:assert/strict');
const { refundUnavailablePurchase } = require('../src/services/refundUnavailablePurchase');

function mockStripe(intent, existing = []) {
  const calls = [];
  return { calls, paymentIntents: { retrieve: async () => intent }, refunds: {
    list: async function* () { yield* existing; },
    create: async (params, options) => { calls.push({ params, options }); return { id: 're_fixture', status: 'succeeded' }; },
  } };
}

test('VIP destination refund reverses the transfer and application fee', async () => {
  const stripe = mockStripe({ transfer_data: { destination: 'acct_fixture' }, application_fee_amount: 100 });
  await refundUnavailablePurchase(stripe, 'pi_fixture', 'vip_table');
  assert.deepEqual(stripe.calls, [{ params: { payment_intent: 'pi_fixture',
    metadata: { eclipse_reason: 'vip_unavailable' }, reverse_transfer: true, refund_application_fee: true },
    options: { idempotencyKey: 'vip-unavailable:pi_fixture' } }]);
});

test('VIP platform charge has no transfer reversal flags', async () => {
  const stripe = mockStripe({ transfer_data: null });
  await refundUnavailablePurchase(stripe, 'pi_fixture', 'vip_table');
  assert.equal(stripe.calls[0].params.reverse_transfer, undefined);
  assert.equal(stripe.calls[0].params.refund_application_fee, undefined);
});

test('previous refund is reused without another charge lookup or refund', async () => {
  const existing = { id: 're_old', status: 'pending', metadata: { eclipse_reason: 'vip_unavailable' } };
  const stripe = mockStripe(null, [existing]);
  stripe.paymentIntents.retrieve = async () => { throw new Error('Should not retrieve'); };
  assert.equal(await refundUnavailablePurchase(stripe, 'pi_fixture', 'vip_table'), existing);
  assert.equal(stripe.calls.length, 0);
});

test('resale keeps its established idempotency key', async () => {
  const stripe = mockStripe(null);
  await refundUnavailablePurchase(stripe, 'pi_fixture', 'resale_ticket');
  assert.equal(stripe.calls[0].options.idempotencyKey, 'resale-unavailable:pi_fixture');
  assert.equal(stripe.calls[0].params.metadata.eclipse_reason, 'resale_unavailable');
});
