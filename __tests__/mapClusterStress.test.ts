import { __test_clusterForRegion } from '@/app/(tabs)/party-map';

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

describe('party-map clustering stress', () => {
  it('clusters many events without exceeding the marker cap', () => {
    const region = {
      latitude: 40.4168,
      longitude: -3.7038,
      latitudeDelta: 4,
      longitudeDelta: 4,
    };

    const events = Array.from({ length: 8000 }).map((_, i) => {
      const t = i / 8000;
      const lat = region.latitude + (t - 0.5) * 3.5;
      const lng = region.longitude + (((i * 997) % 8000) / 8000 - 0.5) * 3.5;
      return {
        id: String(i),
        title: `E${i}`,
        date: '2026-05-16',
        time: '23:00',
        location: 'X',
        price: '0',
        capacity: 0,
        sold: 0,
        imageUrl: '',
        description: '',
        eventType: i % 3 === 0 ? 'fiesta' : i % 3 === 1 ? 'festival' : 'techno',
        _lat: lat,
        _lng: lng,
        _distanceKm: 0,
      } as any;
    });

    const getColor = () => '#fff';
    const out = __test_clusterForRegion(events, region as any, getColor);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(260);
  });

  it('is stable for the same input', () => {
    const region = {
      latitude: 40.4168,
      longitude: -3.7038,
      latitudeDelta: 0.6,
      longitudeDelta: 0.6,
    };

    const events = Array.from({ length: 1200 }).map((_, i) => {
      return {
        id: String(i),
        title: `E${i}`,
        date: '2026-05-16',
        time: '23:00',
        location: 'X',
        price: '0',
        capacity: 0,
        sold: 0,
        imageUrl: '',
        description: '',
        eventType: 'fiesta',
        _lat: region.latitude + ((i % 50) - 25) * 0.002,
        _lng: region.longitude + ((Math.floor(i / 50) % 50) - 25) * 0.002,
        _distanceKm: 0,
      } as any;
    });

    const getColor = () => '#fff';
    const a = __test_clusterForRegion(events, region as any, getColor).map((x: any) => x.key).join('|');
    const b = __test_clusterForRegion(events, region as any, getColor).map((x: any) => x.key).join('|');
    expect(a).toBe(b);
  });
});
