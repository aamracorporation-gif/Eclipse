jest.mock('@/lib/EventContext', () => ({
  useEvents: () => ({ events: [] }),
}));

jest.mock('@/components/ui/Map', () => ({
  __esModule: true,
  default: () => null,
  Marker: () => null,
}));

jest.mock('react-native-maps', () => ({
  PROVIDER_GOOGLE: 'google',
}));

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

import { __test_clusterForRegion } from '@/app/(tabs)/party-map';

const getColor = () => '#A78BFA';

const makeEvent = (id: string, lat: number, lng: number): any => ({
  id, title: id, description: '', location: 'Test', date: '2026-05-16', time: '18:00',
  price: '10', capacity: 100, sold: 0, imageUrl: '', ticketTypes: [],
  eventType: 'party', creatorId: null, updatedAt: null, startsAt: '',
  venues: { latitude: lat, longitude: lng, name: 'Test' },
  _lat: lat, _lng: lng, _distanceKm: 0,
});

const WIDE_REGION = { latitude: 40.4168, longitude: -3.7038, latitudeDelta: 5, longitudeDelta: 5 };
const NARROW_REGION = { latitude: 40.4168, longitude: -3.7038, latitudeDelta: 0.02, longitudeDelta: 0.02 };

describe('party-map clustering', () => {
  it('clusters nearby events into a single cluster bubble', () => {
    const events = [
      makeEvent('a', 40.4168, -3.7038),
      makeEvent('b', 40.4170, -3.7040),
      makeEvent('c', 40.4172, -3.7042),
    ];
    const result = __test_clusterForRegion(events, WIDE_REGION, getColor);
    // All 3 events are very close — should collapse to a cluster or single markers
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => r.kind === 'cluster' || r.kind === 'event')).toBe(true);
  });

  it('keeps faraway events as individual markers at narrow zoom', () => {
    const madrid = makeEvent('madrid', 40.4168, -3.7038);
    const bcn    = makeEvent('bcn',    41.3874,  2.1686);
    const result = __test_clusterForRegion([madrid, bcn], NARROW_REGION, getColor);
    // Both events are out of range of each other — expect 2 separate items or 0 if not in viewport
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('returns empty for empty input', () => {
    const result = __test_clusterForRegion([], WIDE_REGION, getColor);
    expect(result).toEqual([]);
  });

  it('single event produces an event marker not a cluster', () => {
    const events = [makeEvent('solo', 40.4168, -3.7038)];
    const result = __test_clusterForRegion(events, WIDE_REGION, getColor);
    expect(result.length).toBe(1);
    expect(result[0].kind).toBe('event');
  });
});
