/** @jest-environment node */
import { cancelBoxOfficeForDeletion } from '../supabase/functions/_shared/cancelBoxOfficeForDeletion';

const owner = { stripe_customer_id: 'cus_fixture', stripe_subscription_id: 'sub_fixture' };
const project = 'https://uhondxttdpvywvkyqlkk.supabase.co';
const subscription = { id: 'sub_fixture', customer: 'cus_fixture', status: 'active', livemode: false, metadata: { organizer_id: 'organizer', feature: 'box_office_monthly' } };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

it('does nothing when there is no subscription', async () => {
  const send = jest.fn();
  await cancelBoxOfficeForDeletion(null, 'organizer', '', project, send);
  expect(send).not.toHaveBeenCalled();
});
it('confirms ownership and cancellation before allowing account deletion, without a final charge', async () => {
  const send = jest.fn().mockResolvedValueOnce(reply(subscription)).mockResolvedValueOnce(reply({ ...subscription, status: 'canceled' }));
  await cancelBoxOfficeForDeletion(owner, 'organizer', 'sk_test_fixture', project, send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][1].method).toBe('DELETE');
  expect(send.mock.calls[1][1].body.toString()).toBe('invoice_now=false&prorate=false');
});
it.each([
  { ...subscription, customer: 'cus_someoneelse' },
  { ...subscription, metadata: { ...subscription.metadata, organizer_id: 'someoneelse' } },
  { ...subscription, metadata: { ...subscription.metadata, feature: 'other' } },
  { ...subscription, livemode: true },
])('never cancels an unrelated or wrong-environment subscription', async current => {
  const send = jest.fn().mockResolvedValue(reply(current));
  await expect(cancelBoxOfficeForDeletion(owner, 'organizer', 'sk_test_fixture', project, send)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
it('blocks deletion when Stripe cannot confirm cancellation', async () => {
  const send = jest.fn().mockResolvedValueOnce(reply(subscription)).mockResolvedValueOnce(reply({ error: 'unavailable' }, 503));
  await expect(cancelBoxOfficeForDeletion(owner, 'organizer', 'sk_test_fixture', project, send)).rejects.toThrow();
});
it('allows an idempotent retry after a prior successful cancellation', async () => {
  const send = jest.fn().mockResolvedValue(reply({ ...subscription, status: 'canceled' }));
  await cancelBoxOfficeForDeletion(owner, 'organizer', 'sk_test_fixture', project, send);
  expect(send).toHaveBeenCalledTimes(1);
});
it('does not send credentials to the wrong billing environment', async () => {
  const send = jest.fn();
  await expect(cancelBoxOfficeForDeletion(owner, 'organizer', 'sk_live_fixture', project, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it('supports a restricted Stripe key in the matching environment', async () => {
  const send = jest.fn().mockResolvedValue(reply({ ...subscription, status: 'canceled' }));
  await cancelBoxOfficeForDeletion(owner, 'organizer', 'rk_test_fixture', project, send);
  expect(send).toHaveBeenCalledTimes(1);
});

it('recovers after Stripe canceled but its response was lost, without a second cancellation', async () => {
  const send = jest.fn().mockResolvedValueOnce(reply(subscription))
    .mockRejectedValueOnce(new Error('TimeoutError'))
    .mockResolvedValueOnce(reply({ ...subscription, status: 'canceled' }));
  await expect(cancelBoxOfficeForDeletion(owner, 'organizer', 'sk_test_fixture', project, send)).rejects.toThrow('TimeoutError');
  await cancelBoxOfficeForDeletion(owner, 'organizer', 'sk_test_fixture', project, send);
  expect(send.mock.calls.filter(call => call[1]?.method === 'DELETE')).toHaveLength(1);
  expect(send.mock.calls.every(call => call[1]?.signal instanceof AbortSignal)).toBe(true);
});

it.each([{}, { ...subscription, id: 'sub_other', status: 'canceled' }, subscription])('blocks deletion for an unconfirmed cancellation response', async result => {
  const send=jest.fn().mockResolvedValueOnce(reply(subscription)).mockResolvedValueOnce(reply(result));
  await expect(cancelBoxOfficeForDeletion(owner,'organizer','sk_test_fixture',project,send)).rejects.toThrow();
});
