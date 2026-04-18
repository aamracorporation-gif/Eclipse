import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Dimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import MapView, { Marker, Region } from '@/components/ui/Map';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useEvents, AppEvent } from '@/lib/EventContext';
import { supabase } from '@/lib/supabase';
import { MapEventMarker, CrowdLevel } from '@/components/MapEventMarker';
import { router, useLocalSearchParams } from 'expo-router';

type LiveMetrics = {
  event_id: string;
  checkins_count: number | null;
  reports_count: number | null;
  live_viewers: number | null;
  updated_at: string | null;
};

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = Math.min(320, Math.max(260, Math.round(SCREEN_HEIGHT * 0.36)));

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sin1 = Math.sin(dLat / 2);
  const sin2 = Math.sin(dLon / 2);
  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function computeCrowdLevel(event: AppEvent, metrics?: LiveMetrics | null) {
  const sold = event.sold || 0;
  const remaining = event.capacity || 0;
  const total = Math.max(1, sold + remaining);
  const checkins = metrics?.checkins_count ?? 0;
  const reports = metrics?.reports_count ?? 0;
  const viewers = metrics?.live_viewers ?? 0;

  const raw = sold + checkins * 0.25 + reports * 0.15 + viewers * 0.05;
  const ratio = raw / total;

  const trending = viewers >= 25 || reports >= 10 || checkins >= 30;

  const level: CrowdLevel = ratio >= 0.9 ? 'full' : ratio >= 0.55 ? 'medium' : 'low';
  return { level, trending, estimatedAttendees: Math.round(raw), ratio };
}

export default function PartyMapScreen() {
  const insets = useSafeAreaInsets();
  const { events } = useEvents();
  const params = useLocalSearchParams<{ eventId?: string }>();

  const [locationPermission, setLocationPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [region, setRegion] = useState<Region>({
    latitude: 40.4168,
    longitude: -3.7038,
    latitudeDelta: 0.09,
    longitudeDelta: 0.09,
  });

  const [metricsByEventId, setMetricsByEventId] = useState<Record<string, LiveMetrics>>({});
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const mapRef = useRef<MapView>(null);
  const sheetY = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  const eventsWithVenue = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => {
      if (!e.venues) return false;
      const raw = e.startsAt ? new Date(e.startsAt).getTime() : Number.NaN;
      const fallback = new Date(`${e.date}T${e.time}`).getTime();
      const startAt = Number.isFinite(raw) ? raw : fallback;
      if (!Number.isFinite(startAt)) return false;
      return startAt >= now;
    });
  }, [events]);
  const selectedEvent = useMemo(
    () => eventsWithVenue.find((e) => e.id === selectedEventId) ?? null,
    [eventsWithVenue, selectedEventId]
  );

  const selectedMetrics = selectedEvent ? metricsByEventId[selectedEvent.id] : undefined;
  const selectedComputed = selectedEvent ? computeCrowdLevel(selectedEvent, selectedMetrics) : null;

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!isMounted) return;

        if (permission.status !== 'granted') {
          setLocationPermission('denied');
          return;
        }

        setLocationPermission('granted');

        const position = await Location.getCurrentPositionAsync({});
        if (!isMounted) return;

        const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setUserCoords(coords);
        const nextRegion: Region = { ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 };
        setRegion(nextRegion);
        mapRef.current?.animateToRegion(nextRegion, 800);
      } catch {
        if (isMounted) setLocationPermission('denied');
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [sheetY]);

  useEffect(() => {
    let isMounted = true;
    const ids = eventsWithVenue.map((e) => e.id);

    if (!ids.length) return;

    (async () => {
      const { data } = await supabase.from('event_live_metrics').select('*').in('event_id', ids);
      if (!isMounted) return;
      if (!data) return;

      const next: Record<string, LiveMetrics> = {};
      for (const row of data as any[]) {
        next[row.event_id] = row as LiveMetrics;
      }
      setMetricsByEventId(next);
    })();

    return () => {
      isMounted = false;
    };
  }, [eventsWithVenue]);

  useEffect(() => {
    const targetId = params?.eventId;
    if (!targetId) return;
    const target = eventsWithVenue.find((e) => e.id === targetId);
    if (!target?.venues) return;
    setSelectedEventId(target.id);
    setSheetOpen(true);
    mapRef.current?.animateToRegion(
      {
        latitude: Number(target.venues.latitude),
        longitude: Number(target.venues.longitude),
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      },
      700
    );
  }, [eventsWithVenue, params?.eventId, sheetY]);

  useEffect(() => {
    const channel = supabase
      .channel('event-live-metrics-map')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_live_metrics' },
        (payload) => {
          const next = payload.new as any;
          if (!next?.event_id) return;
          setMetricsByEventId((prev) => ({ ...prev, [next.event_id]: next as LiveMetrics }));
        }
      )
      .subscribe();

    const poll = setInterval(async () => {
      const ids = eventsWithVenue.map((e) => e.id);
      if (!ids.length) return;
      const { data } = await supabase.from('event_live_metrics').select('*').in('event_id', ids);
      if (!data) return;
      setMetricsByEventId((prev) => {
        const next = { ...prev };
        for (const row of data as any[]) {
          next[row.event_id] = row as LiveMetrics;
        }
        return next;
      });
    }, 15000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [eventsWithVenue]);

  useEffect(() => {
    Animated.spring(sheetY, {
      toValue: sheetOpen ? 0 : SHEET_HEIGHT,
      useNativeDriver: true,
      damping: 22,
      stiffness: 260,
      mass: 0.9,
    }).start();
  }, [sheetOpen, sheetY]);

  const openSheetForEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
  };

  const distanceKm = useMemo(() => {
    if (!selectedEvent?.venues || !userCoords) return null;
    return haversineKm(userCoords, {
      latitude: Number(selectedEvent.venues.latitude),
      longitude: Number(selectedEvent.venues.longitude),
    });
  }, [selectedEvent, userCoords]);

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0B0B14', '#12081C', '#0B0B14']} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.header, { paddingTop: Math.max(10, insets.top) }]}>
          <Text style={styles.title}>Party Map</Text>
          <Text style={styles.subtitle}>Eventos cerca de ti, en tiempo real</Text>
        </View>

        <View style={styles.mapContainer}>
          {locationPermission === 'loading' ? (
            <View style={styles.loading}>
              <DiscoLoader size={74} />
              <Text style={styles.loadingText}>Cargando mapa...</Text>
            </View>
          ) : (
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              initialRegion={region}
              onRegionChangeComplete={setRegion}
              showsUserLocation={locationPermission === 'granted'}
              showsMyLocationButton={false}
            >
              {eventsWithVenue.map((event) => {
                const venue = event.venues;
                if (!venue) return null;
                const metrics = metricsByEventId[event.id];
                const { level, trending } = computeCrowdLevel(event, metrics);

                return (
                  <Marker
                    key={event.id}
                    coordinate={{
                      latitude: Number(venue.latitude),
                      longitude: Number(venue.longitude),
                    }}
                    onPress={() => openSheetForEvent(event.id)}
                  >
                    <MapEventMarker crowdLevel={level} trending={trending} />
                  </Marker>
                );
              })}
            </MapView>
          )}
        </View>
      </SafeAreaView>

      <Pressable
        onPress={closeSheet}
        style={[styles.backdrop, { opacity: sheetOpen ? 1 : 0, pointerEvents: sheetOpen ? 'auto' : 'none' }]}
      />

      <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}>
        <GlassView intensity={22} style={styles.sheetInner}>
          {selectedEvent && selectedComputed ? (
            <>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventTitle} numberOfLines={1}>
                    {selectedEvent.title}
                  </Text>
                  <Text style={styles.clubName} numberOfLines={1}>
                    {selectedEvent.creatorProfile?.club_name || selectedEvent.venues?.name || 'Club'}
                  </Text>
                </View>
                {selectedComputed.trending ? (
                  <View style={styles.trendingPill}>
                    <Text style={styles.trendingPillText}>🔥 Trending Party</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Crowd</Text>
                  <Text style={styles.statValue}>
                    {selectedComputed.level === 'full' ? 'Full' : selectedComputed.level === 'medium' ? 'Medium' : 'Low'}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Attendees</Text>
                  <Text style={styles.statValue}>{selectedComputed.estimatedAttendees}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Distance</Text>
                  <Text style={styles.statValue}>
                    {distanceKm === null ? '--' : distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`}
                  </Text>
                </View>
              </View>

              <ThemedButton
                title="View Event"
                onPress={() => {
                  closeSheet();
                  router.push(`/(tabs)/event/${selectedEvent.id}`);
                }}
                style={{ marginTop: 14 }}
              />
            </>
          ) : (
            <View style={{ paddingTop: 18 }}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetEmpty}>Toca un marker para ver detalles</Text>
            </View>
          )}
        </GlassView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B14' },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 18, paddingBottom: 12 },
  title: { color: 'white', fontSize: 26, fontWeight: '900', letterSpacing: 0.4 },
  subtitle: { marginTop: 4, color: Colors.dark.textSecondary, fontSize: 13, fontWeight: '600' },
  mapContainer: { flex: 1, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: Colors.dark.textSecondary, fontWeight: '600' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SHEET_HEIGHT,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  sheetInner: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 10,
  },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eventTitle: { color: 'white', fontSize: 18, fontWeight: '900' },
  clubName: { marginTop: 2, color: Colors.dark.textSecondary, fontWeight: '700' },
  trendingPill: {
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  trendingPillText: { color: 'white', fontWeight: '900', fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  statLabel: { color: Colors.dark.textSecondary, fontWeight: '800', fontSize: 11 },
  statValue: { marginTop: 6, color: 'white', fontWeight: '900', fontSize: 14 },
  sheetEmpty: { color: Colors.dark.textSecondary, fontWeight: '700', textAlign: 'center' },
});
