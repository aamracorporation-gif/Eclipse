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

import { __test_filterMapEventIds, __test_getFocusRegion } from '@/app/(tabs)/party-map';

describe('party-map markers stability', () => {
  it('does not cull events by zoom/viewport: returns the same set for different "zoom" scenarios', () => {
    const nowMs = new Date('2026-05-16T12:00:00.000Z').getTime();

    const events: any[] = [
      {
        id: 'a',
        title: 'A',
        description: '',
        location: 'Madrid',
        date: '2026-05-16',
        time: '18:00',
        price: '10',
        capacity: 100,
        sold: 0,
        imageUrl: '',
        ticketTypes: [],
        venues: { latitude: 40.4168, longitude: -3.7038, name: 'Madrid' },
      },
      {
        id: 'b',
        title: 'B',
        description: '',
        location: 'Barcelona',
        date: '2026-05-17',
        time: '02:00',
        price: '10',
        capacity: 100,
        sold: 0,
        imageUrl: '',
        ticketTypes: [],
        venues: { latitude: 41.3874, longitude: 2.1686, name: 'BCN' },
      },
      {
        id: 'bad-geo',
        title: 'Bad',
        description: '',
        location: 'Somewhere',
        date: '2026-05-17',
        time: '02:00',
        price: '10',
        capacity: 100,
        sold: 0,
        imageUrl: '',
        ticketTypes: [],
        venues: { latitude: Number.NaN, longitude: 2.1686, name: 'X' },
      },
      {
        id: 'old',
        title: 'Old',
        description: '',
        location: 'Madrid',
        date: '2026-05-10',
        time: '02:00',
        price: '10',
        capacity: 100,
        sold: 0,
        imageUrl: '',
        ticketTypes: [],
        venues: { latitude: 40.4168, longitude: -3.7038, name: 'Madrid' },
      },
    ];

    const idsZoomIn = __test_filterMapEventIds(events as any, 'sevilla', nowMs).sort();
    const idsZoomOut = __test_filterMapEventIds(events as any, 'madrid', nowMs).sort();
    expect(idsZoomIn).toEqual(idsZoomOut);
    expect(idsZoomIn).toEqual(['a', 'b']);
  });

  it('focus region centers exactly on the event coordinates with a stable zoom delta', () => {
    const r = __test_getFocusRegion(10.5, -20.25);
    expect(r.latitude).toBe(10.5);
    expect(r.longitude).toBe(-20.25);
    expect(r.latitudeDelta).toBeGreaterThan(0);
    expect(r.longitudeDelta).toBeGreaterThan(0);
    expect(r.latitudeDelta).toBe(r.longitudeDelta);
  });
});
