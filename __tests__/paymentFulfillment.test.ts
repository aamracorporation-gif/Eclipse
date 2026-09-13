import { waitForFulfillment } from '../lib/payments/waitForFulfillment';

const pending = { kind: 'event_ticket' as const, fulfilled: false, status: 'created' };
const complete = { ...pending, fulfilled: true, status: 'fulfilled' };
const sleep = async () => {};

test('waits for a delayed webhook without creating another payment', async () => {
  const read = jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValue(complete);
  expect(await waitForFulfillment(read, { sleep })).toEqual(complete);
  expect(read).toHaveBeenCalledTimes(3);
});

test('recovers from a lost status response after a payment', async () => {
  const read = jest.fn().mockRejectedValueOnce(new Error('network lost')).mockResolvedValue(complete);
  expect(await waitForFulfillment(read, { sleep })).toEqual(complete);
});

test('leaves an unknown payment pending when every status request fails', async () => {
  const read = jest.fn().mockRejectedValue(new Error('offline'));
  expect(await waitForFulfillment(read, { attempts: 2, sleep })).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
});

test('a delayed failure notification does not stop checking for success', async () => {
  const read = jest.fn().mockResolvedValueOnce({ ...pending, status: 'failed' }).mockResolvedValue(complete);
  expect(await waitForFulfillment(read, { sleep })).toEqual(complete);
});

test('returns a known cancellation without further polling', async () => {
  const cancelled = { ...pending, status: 'canceled' };
  const read = jest.fn().mockResolvedValue(cancelled);
  expect(await waitForFulfillment(read, { sleep })).toEqual(cancelled);
  expect(read).toHaveBeenCalledTimes(1);
});
