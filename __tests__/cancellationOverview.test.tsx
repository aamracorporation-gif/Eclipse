import React from 'react';
import { useCancellationOverview } from '../lib/payments/useCancellationOverview';
import { organizerBillingRequest } from '../lib/payments/organizerBilling';
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { unmount: () => void; update: (element: React.ReactElement) => void };
};

let mockUserId = 'organizer-a';
jest.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('../lib/payments/organizerBilling', () => ({ organizerBillingVisible: true, organizerBillingRequest: jest.fn() }));
const request = organizerBillingRequest as jest.Mock;
let current: ReturnType<typeof useCancellationOverview>;
function Probe() { current = useCancellationOverview(); return null; }
const overview = (id: string) => ({ ready: true, policy: {}, costs: [], cancellations: [{ id }] });
let root: ReturnType<typeof create>;
beforeEach(() => { jest.useFakeTimers(); mockUserId = 'organizer-a'; request.mockReset(); });
afterEach(() => { if (root) act(() => root.unmount()); jest.useRealTimers(); });

test('loads organizer history and refreshes after an operation', async () => {
  request.mockResolvedValueOnce(overview('first')).mockResolvedValueOnce(overview('new'));
  await act(async () => { root = create(<Probe />); });
  expect(current.data?.cancellations[0].id).toBe('first');
  await act(async () => { await current.refresh(); });
  expect(current.data?.cancellations[0].id).toBe('new');
  expect(current.loading).toBe(false);
});
test('keeps last known history and reports refresh failure, not a fake empty state', async () => {
  request.mockResolvedValueOnce(overview('saved')).mockRejectedValueOnce(new Error('Sin conexión'));
  await act(async () => { root = create(<Probe />); });
  await act(async () => { await current.refresh(); });
  expect(current.error).toBe('Sin conexión');
  expect(current.data?.cancellations[0].id).toBe('saved');
});
test('late responses cannot replace another organizer history', async () => {
  let resolveOld!: (data: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(overview('account-b'));
  await act(async () => { root = create(<Probe />); });
  mockUserId = 'organizer-b';
  await act(async () => { root.update(<Probe />); });
  await act(async () => { resolveOld(overview('account-a')); });
  expect(current.data?.cancellations[0].id).toBe('account-b');
});
test('older requests cannot overwrite a more recent refresh', async () => {
  let resolveOld!: (data: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(overview('latest'));
  await act(async () => { root = create(<Probe />); });
  await act(async () => { await current.refresh(); });
  await act(async () => { resolveOld(overview('stale')); });
  expect(current.data?.cancellations[0].id).toBe('latest');
});
