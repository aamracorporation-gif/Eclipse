import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, StatusBar, Platform, Image, TextInput, Keyboard, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import MapView, { Marker, Region } from '@/components/ui/Map';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import type { AppEvent } from '@/lib/EventContext';
import { router, useLocalSearchParams } from 'expo-router';
import { Search, X, MapPin, Calendar } from '@/lib/icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { useAppDialog } from '@/components/ui/AppDialog';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { PROVIDER_GOOGLE } from 'react-native-maps';
import Constants from 'expo-constants';

type EventWithGeo = AppEvent & { _lat: number; _lng: number; _distanceKm: number };

const VIEWPORT_DEBOUNCE_MS = 520;
const EVENT_FOCUS_DELTA = 0.035;
const MAX_MARKERS_RENDERED = 180;
const FETCH_HORIZON_DAYS = 45;
const MAX_EVENTS_CACHE = 2500;
const MAX_EVENT_CACHE_AGE_MS = 1000 * 60 * 20;

type ClusterItem =
  | { kind: 'cluster'; key: string; center: { latitude: number; longitude: number }; count: number; color: string }
  | { kind: 'event'; key: string; center: { latitude: number; longitude: number }; event: EventWithGeo; color: string };

const MUTED_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0B0B14' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A1A1AA' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0B0B14' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#151528' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#232344' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0A1A2B' }] },
];

const LIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F6F7FB' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#3F3F46' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F6F7FB' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E4E4E7' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#DCEBFA' }] },
];

const ClusterBubble = memo(({ count, color }: { count: number; color: string }) => {
  return (
    <View style={[styles.clusterBubble, { borderColor: color }]}>
      <Text style={styles.clusterText}>{count}</Text>
    </View>
  );
});

ClusterBubble.displayName = 'ClusterBubble';

const EventDot = memo(({ color }: { color: string }) => {
  return (
    <View style={[styles.eventDot, { borderColor: color }]}>
      <View style={[styles.eventDotInner, { backgroundColor: color }]} />
    </View>
  );
});

EventDot.displayName = 'EventDot';

export function __test_filterMapEventIds(events: AppEvent[], _searchText: string, nowMs: number) {
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const maxHorizonMs = todayStartMs + 1000 * 60 * 60 * 24 * 180;
  const q = '';

  return (events || [])
    .filter((e) => {
      const raw = e.startsAt ? new Date(e.startsAt).getTime() : Number.NaN;
      const fallback = new Date(`${e.date}T${e.time}`).getTime();
      const startAt = Number.isFinite(raw) ? raw : fallback;
      return Number.isFinite(startAt) && startAt >= todayStartMs && startAt <= maxHorizonMs;
    })
    .filter((e) => {
      if (!e.venues) return false;
      const lat = Number(e.venues.latitude);
      const lng = Number(e.venues.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng);
    })
    .filter((e) => {
      if (!q) return true;
      return (
        (e.title?.toLowerCase() || '').includes(q) ||
        (e.location?.toLowerCase() || '').includes(q) ||
        (e.description?.toLowerCase() || '').includes(q) ||
        (e.eventType?.toLowerCase() || '').includes(q)
      );
    })
    .map((e) => String(e.id));
}

export function __test_getFocusRegion(lat: number, lng: number) {
  return { latitude: lat, longitude: lng, latitudeDelta: EVENT_FOCUS_DELTA, longitudeDelta: EVENT_FOCUS_DELTA };
}

export function __test_clusterForRegion(list: EventWithGeo[], r: Region, getColor: (eventType?: string | null) => string) {
  const tryCluster = (stepMultiplier: number) => {
    const latStep = Math.max(0.002, (r.latitudeDelta / 14) * stepMultiplier);
    const lngStep = Math.max(0.002, (r.longitudeDelta / 14) * stepMultiplier);

    const buckets = new Map<string, EventWithGeo[]>();
    for (const e of list) {
      const key = `${Math.floor(e._lat / latStep)}:${Math.floor(e._lng / lngStep)}`;
      const arr = buckets.get(key);
      if (arr) arr.push(e);
      else buckets.set(key, [e]);
    }
    return buckets;
  };

  let stepMultiplier = 1;
  let buckets = tryCluster(stepMultiplier);
  while (buckets.size > MAX_MARKERS_RENDERED && stepMultiplier < 12) {
    stepMultiplier *= 1.35;
    buckets = tryCluster(stepMultiplier);
  }

  const out: ClusterItem[] = [];
  for (const [bucketKey, items] of buckets.entries()) {
    if (items.length === 1) {
      const e = items[0];
      out.push({
        kind: 'event',
        key: `e:${e.id}`,
        center: { latitude: e._lat, longitude: e._lng },
        event: e,
        color: getColor(e.eventType),
      });
      continue;
    }
    const avgLat = items.reduce((s, it) => s + it._lat, 0) / items.length;
    const avgLng = items.reduce((s, it) => s + it._lng, 0) / items.length;
    const first = items[0];
    out.push({
      kind: 'cluster',
      key: `c:${bucketKey}`,
      center: { latitude: avgLat, longitude: avgLng },
      count: items.length,
      color: getColor(first?.eventType),
    });
  }
  return out.sort((a, b) => (b.kind === 'cluster' ? b.count : 1) - (a.kind === 'cluster' ? a.count : 1));
}

export default function PartyMapScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const { show: showDialog } = useAppDialog();
  const params = useLocalSearchParams<{ q?: string }>();

  const debugLog = useCallback((...args: any[]) => {
    if (!__DEV__) return;
    try {
      console.log('[MAP]', ...args);
    } catch {}
  }, []);

  const mapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const hasMapsKey =
    Platform.OS !== 'android' || (Constants as any)?.appOwnership === 'expo' || (!!mapsApiKey && !mapsApiKey.includes('TU_CLAVE_API'));

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  const mapRef = useRef<MapView>(null);
  const [locationPermission, setLocationPermission] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [initialRegion, setInitialRegion] = useState<Region>({
    latitude: 40.4168,
    longitude: -3.7038,
    latitudeDelta: 0.14,
    longitudeDelta: 0.14,
  });
  const viewportRegionRef = useRef<Region>(initialRegion);
  const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeSeqRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapMountKey, setMapMountKey] = useState(0);
  const [mapInitTimedOut, setMapInitTimedOut] = useState(false);
  const mapRetryRef = useRef(false);
  const mapEverReadyRef = useRef(false);
  const mapInitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trackMarkers, setTrackMarkers] = useState(Platform.OS === 'android');
  const trackMarkersTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibleClusters, setVisibleClusters] = useState<ClusterItem[]>([]);
  const lastClustersSignatureRef = useRef<string>('');
  const allEventsRef = useRef<Map<string, (EventWithGeo & { _seenAt: number })>>(new Map());
  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchSeqRef = useRef(0);
  const inFlightBboxKeyRef = useRef<string>('');
  const lastSuccessBboxKeyRef = useRef<string>('');
  const lastSuccessAtRef = useRef<number>(0);
  const [selectedEvent, setSelectedEvent] = useState<EventWithGeo | null>(null);

  const [searchText, setSearchText] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const cardOpacity = useSharedValue(0);
  const cardY = useSharedValue(18);

  const cardStyle = useAnimatedStyle(() => ({ opacity: cardOpacity.value, transform: [{ translateY: cardY.value }] }), []);

  const clamp = useCallback((n: number, min: number, max: number) => Math.min(max, Math.max(min, n)), []);

  const sanitizeRegion = useCallback(
    (r: Region): Region => {
      const lat = Number(r?.latitude);
      const lng = Number(r?.longitude);
      const latDelta = Number(r?.latitudeDelta);
      const lngDelta = Number(r?.longitudeDelta);

      const safeLat = Number.isFinite(lat) ? clamp(lat, -85, 85) : 40.4168;
      const safeLng = Number.isFinite(lng) ? clamp(lng, -180, 180) : -3.7038;
      const safeLatDelta = Number.isFinite(latDelta) ? clamp(latDelta, 0.002, 2.0) : 0.14;
      const safeLngDelta = Number.isFinite(lngDelta) ? clamp(lngDelta, 0.002, 2.0) : 0.14;

      return { latitude: safeLat, longitude: safeLng, latitudeDelta: safeLatDelta, longitudeDelta: safeLngDelta };
    },
    [clamp]
  );

  const haversineKm = useCallback((lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, []);

  const eventColor = useCallback((eventType?: string | null) => {
    const tt = String(eventType || '').toLowerCase();
    if (tt.includes('concert') || tt.includes('concierto')) return '#38BDF8';
    if (tt.includes('festival')) return '#FB923C';
    if (tt.includes('party') || tt.includes('fiesta')) return Colors.dark.primary;
    if (tt.includes('techno')) return '#A78BFA';
    return '#34D399';
  }, []);

  const formatPriceEUR = useCallback((raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return `${raw}€`;
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
  }, []);

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, ms: number) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('timeout')), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, []);

  const bumpMarkerTracking = useCallback(() => {
    if (Platform.OS !== 'android') return;
    setTrackMarkers(true);
    if (trackMarkersTimeoutRef.current) clearTimeout(trackMarkersTimeoutRef.current);
    trackMarkersTimeoutRef.current = setTimeout(() => setTrackMarkers(false), 650);
  }, []);

  useEffect(() => {
    return () => {
      if (trackMarkersTimeoutRef.current) clearTimeout(trackMarkersTimeoutRef.current);
    };
  }, []);

  const clusterForRegion = useCallback(
    (list: EventWithGeo[], r: Region): ClusterItem[] => {
      return __test_clusterForRegion(list, r, eventColor);
    },
    [eventColor]
  );

  const computeVisibleClusters = useCallback(
    (regionForViewport: Region) => {
      const list = Array.from(allEventsRef.current.values());

      const latPad = regionForViewport.latitudeDelta * 0.65;
      const lngPad = regionForViewport.longitudeDelta * 0.65;
      const minLat = regionForViewport.latitude - regionForViewport.latitudeDelta / 2 - latPad;
      const maxLat = regionForViewport.latitude + regionForViewport.latitudeDelta / 2 + latPad;
      const minLng = regionForViewport.longitude - regionForViewport.longitudeDelta / 2 - lngPad;
      const maxLng = regionForViewport.longitude + regionForViewport.longitudeDelta / 2 + lngPad;
      const visible = list.filter((e) => e._lat >= minLat && e._lat <= maxLat && e._lng >= minLng && e._lng <= maxLng);

      const clustered = clusterForRegion(visible, regionForViewport);
      const signature = clustered
        .slice(0, 100)
        .map((c) => (c.kind === 'cluster' ? `${c.key}:${c.count}` : c.key))
        .join('|');

      if (signature === lastClustersSignatureRef.current) return;
      lastClustersSignatureRef.current = signature;
      setVisibleClusters(clustered);
      debugLog('clusters', { visible: visible.length, clustered: clustered.length, cacheSize: allEventsRef.current.size });
      bumpMarkerTracking();
    },
    [bumpMarkerTracking, clusterForRegion, debugLog]
  );

  const bboxForRegion = useCallback((r: Region) => {
    const latPad = r.latitudeDelta * 0.85;
    const lngPad = r.longitudeDelta * 0.85;
    const minLat = r.latitude - r.latitudeDelta / 2 - latPad;
    const maxLat = r.latitude + r.latitudeDelta / 2 + latPad;
    const minLng = r.longitude - r.longitudeDelta / 2 - lngPad;
    const maxLng = r.longitude + r.longitudeDelta / 2 + lngPad;
    return { minLat, maxLat, minLng, maxLng };
  }, []);

  const mergeRemoteEvents = useCallback(
    (remote: any[], center: { latitude: number; longitude: number }) => {
      const nowMs = Date.now();
      const localeTag = 'es-ES';
      const pad2 = (n: number) => String(n).padStart(2, '0');

      let changed = false;
      for (const raw of remote || []) {
        const id = String(raw?.id || '');
        if (!id) continue;
        const venue = raw?.venues || {};
        const lat = Number(venue.latitude);
        const lng = Number(venue.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const eventDate = new Date(raw.event_date);
        const localDate = `${eventDate.getFullYear()}-${pad2(eventDate.getMonth() + 1)}-${pad2(eventDate.getDate())}`;
        const time = eventDate.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' });

        const mapped: EventWithGeo = {
          id,
          title: String(raw.title || ''),
          startsAt: raw.event_date,
          updatedAt: raw.updated_at || null,
          date: localDate,
          time,
          location: String(venue.name || 'Ubicación desconocida'),
          price: String(raw.ticket_price ?? ''),
          capacity: Number(raw.available_tickets ?? 0),
          sold: Number(raw.sold_tickets ?? 0),
          imageUrl: String(raw.poster_url || ''),
          venuePlanUrl: raw.venue_plan_url || undefined,
          description: String(raw.description || ''),
          theme: raw.theme ?? null,
          ageRestriction: raw.age_restriction != null ? String(raw.age_restriction) : undefined,
          dressCode: raw.dress_code ?? null,
          eventType: String(raw.event_type ?? '').trim() || 'party',
          creatorId: raw.creator_id ?? undefined,
          ticketTypes: [],
          venues: { latitude: lat, longitude: lng, name: String(venue.name || '') },
          _lat: lat,
          _lng: lng,
          _distanceKm: haversineKm(center.latitude, center.longitude, lat, lng),
        } as any;

        const prev = allEventsRef.current.get(id);
        const prevUpdated = prev?.updatedAt ?? null;
        const nextUpdated = mapped.updatedAt ?? null;
        const shouldReplace = !prev || (nextUpdated && prevUpdated !== nextUpdated);

        if (shouldReplace) {
          allEventsRef.current.set(id, { ...mapped, _seenAt: nowMs });
          changed = true;
        } else if (prev) {
          prev._seenAt = nowMs;
        }
      }

      if (changed && selectedEventId) {
        const cur = allEventsRef.current.get(selectedEventId);
        if (cur) setSelectedEvent(cur);
      }
    },
    [haversineKm, selectedEventId]
  );

  const pruneAllEvents = useCallback((regionForViewport: Region) => {
    const maxKeep = MAX_EVENTS_CACHE;
    const now = Date.now();

    for (const [id, e] of allEventsRef.current.entries()) {
      const seen = Number((e as any)?._seenAt || 0);
      if (seen && now - seen > MAX_EVENT_CACHE_AGE_MS) {
        allEventsRef.current.delete(id);
      }
    }

    if (allEventsRef.current.size <= maxKeep) return;
    const { minLat, maxLat, minLng, maxLng } = bboxForRegion(regionForViewport);
    const farMinLat = minLat - regionForViewport.latitudeDelta * 3;
    const farMaxLat = maxLat + regionForViewport.latitudeDelta * 3;
    const farMinLng = minLng - regionForViewport.longitudeDelta * 3;
    const farMaxLng = maxLng + regionForViewport.longitudeDelta * 3;

    const candidates: [string, number][] = [];
    for (const [id, e] of allEventsRef.current.entries()) {
      const far =
        e._lat < farMinLat || e._lat > farMaxLat || e._lng < farMinLng || e._lng > farMaxLng;
      if (!far) continue;
      candidates.push([id, e._seenAt || 0]);
    }
    candidates.sort((a, b) => a[1] - b[1]);
    for (const [id] of candidates) {
      allEventsRef.current.delete(id);
      if (allEventsRef.current.size <= maxKeep) break;
    }

    if (allEventsRef.current.size > maxKeep) {
      const all = Array.from(allEventsRef.current.entries()).sort((a, b) => (a[1]._seenAt || 0) - (b[1]._seenAt || 0));
      for (const [id] of all) {
        allEventsRef.current.delete(id);
        if (allEventsRef.current.size <= maxKeep) break;
      }
    }
  }, [bboxForRegion]);

  const fetchEventsForRegion = useCallback(
    async (regionForViewport: Region) => {
      const safe = sanitizeRegion(regionForViewport);
      const { minLat, maxLat, minLng, maxLng } = bboxForRegion(safe);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const fromIso = todayStart.toISOString();
      const toIso = new Date(todayStart.getTime() + 1000 * 60 * 60 * 24 * FETCH_HORIZON_DAYS).toISOString();

      const bboxKey = `${minLat.toFixed(4)}|${maxLat.toFixed(4)}|${minLng.toFixed(4)}|${maxLng.toFixed(4)}|${safe.latitudeDelta.toFixed(4)}`;
      if (bboxKey === inFlightBboxKeyRef.current) return;
      if (bboxKey === lastSuccessBboxKeyRef.current && Date.now() - lastSuccessAtRef.current < 15000) return;

      if (fetchAbortRef.current) fetchAbortRef.current.abort();
      const ctrl = new AbortController();
      fetchAbortRef.current = ctrl;
      const seq = ++fetchSeqRef.current;
      inFlightBboxKeyRef.current = bboxKey;

      try {
        if (!supabaseUrl || !supabaseAnonKey) throw new Error('missing_supabase_env');
        const base = supabaseUrl.replace(/\/$/, '');
        const select =
          'id,title,description,poster_url,venue_plan_url,event_date,ticket_price,available_tickets,sold_tickets,dress_code,age_restriction,theme,event_type,creator_id,updated_at,venues!inner(name,latitude,longitude)';
        const url =
          `${base}/rest/v1/events` +
          `?select=${encodeURIComponent(select)}` +
          `&order=${encodeURIComponent('event_date.asc')}` +
          `&event_date=${encodeURIComponent(`gte.${fromIso}`)}` +
          `&event_date=${encodeURIComponent(`lte.${toIso}`)}` +
          `&venues.latitude=${encodeURIComponent(`gte.${minLat}`)}` +
          `&venues.latitude=${encodeURIComponent(`lte.${maxLat}`)}` +
          `&venues.longitude=${encodeURIComponent(`gte.${minLng}`)}` +
          `&venues.longitude=${encodeURIComponent(`lte.${maxLng}`)}`;

        debugLog('fetch:start', { bboxKey, fromIso, toIso });
        const res = await withTimeout(
          fetch(url, {
            method: 'GET',
            signal: ctrl.signal,
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
            },
          }),
          12000
        );
        if (seq !== fetchSeqRef.current) return;
        if (!res.ok) throw new Error(`http_${res.status}`);
        const remote = await res.json();
        debugLog('fetch:done', { bboxKey, count: Array.isArray(remote) ? remote.length : 0 });
        if (!Array.isArray(remote)) return;
        mergeRemoteEvents(remote, { latitude: safe.latitude, longitude: safe.longitude });
        lastSuccessBboxKeyRef.current = bboxKey;
        lastSuccessAtRef.current = Date.now();
        pruneAllEvents(safe);
        computeVisibleClusters(safe);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        debugLog('fetch:error', { bboxKey, message: String(e?.message || e) });
        computeVisibleClusters(safe);
      } finally {
        if (inFlightBboxKeyRef.current === bboxKey) inFlightBboxKeyRef.current = '';
      }
    },
    [bboxForRegion, computeVisibleClusters, debugLog, mergeRemoteEvents, pruneAllEvents, sanitizeRegion, supabaseAnonKey, supabaseUrl, withTimeout]
  );

  useEffect(() => {
    debugLog('mount');
    return () => debugLog('unmount');
  }, [debugLog]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const permission = await withTimeout(Location.requestForegroundPermissionsAsync(), 6000);
        if (!mounted) return;
        if (permission.status !== 'granted') {
          setLocationPermission('denied');
          return;
        }
        setLocationPermission('granted');
        const pos = await withTimeout(Location.getCurrentPositionAsync({}), 8000);
        if (!mounted) return;
        const next = sanitizeRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.10, longitudeDelta: 0.10 });
        viewportRegionRef.current = next;
        setInitialRegion(next);
        try {
          mapRef.current?.animateToRegion(next, 700);
        } catch {}
      } catch {
        if (mounted) setLocationPermission('denied');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [sanitizeRegion, withTimeout]);

  const handleRegionChangeComplete = useCallback((r: Region) => {
    const next = sanitizeRegion(r);
    viewportRegionRef.current = next;
    if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    viewportDebounceRef.current = setTimeout(() => {
      computeVisibleClusters(next);
      void fetchEventsForRegion(next);
    }, VIEWPORT_DEBOUNCE_MS);
  }, [computeVisibleClusters, fetchEventsForRegion, sanitizeRegion]);

  useEffect(() => {
    return () => {
      if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (fetchAbortRef.current) fetchAbortRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (locationPermission === 'loading') return;
    if (!hasMapsKey) return;
    setMapInitTimedOut(false);
    if (mapEverReadyRef.current) return;
    if (mapInitTimerRef.current) clearTimeout(mapInitTimerRef.current);
    mapInitTimerRef.current = setTimeout(() => {
      setMapInitTimedOut(true);
      if (!mapRetryRef.current) {
        mapRetryRef.current = true;
        setMapMountKey((k) => k + 1);
      }
    }, 12000);
    return () => {
      if (mapInitTimerRef.current) clearTimeout(mapInitTimerRef.current);
    };
  }, [hasMapsKey, locationPermission, mapMountKey]);

  useEffect(() => {
    if (!mapReady) return;
    debugLog('ready');
    mapEverReadyRef.current = true;
    if (mapInitTimerRef.current) clearTimeout(mapInitTimerRef.current);
    setMapInitTimedOut(false);
  }, [debugLog, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    computeVisibleClusters(viewportRegionRef.current);
    void fetchEventsForRegion(viewportRegionRef.current);
  }, [computeVisibleClusters, fetchEventsForRegion, mapReady]);

  useEffect(() => {
    if (selectedEventId) return;
    if (!selectedEvent) return;
    setSelectedEvent(null);
  }, [selectedEvent, selectedEventId]);

  useEffect(() => {
    if (!selectedEvent) {
      cardOpacity.value = withTiming(0, { duration: 180 });
      cardY.value = withTiming(18, { duration: 180 });
      return;
    }
    cardOpacity.value = 0;
    cardY.value = 18;
    cardOpacity.value = withTiming(1, { duration: 220 });
    cardY.value = withSpring(0, { damping: 18, stiffness: 260, mass: 0.9 });
  }, [cardOpacity, cardY, selectedEvent]);

  const applyGeocode = useCallback(
    async (q: string) => {
      const text = q.trim();
      if (!text) return;
      Keyboard.dismiss();
      const reqId = ++geocodeSeqRef.current;
      try {
        const hits = await withTimeout(Location.geocodeAsync(text), 8000);
        if (reqId !== geocodeSeqRef.current) return;
        if (!hits?.length) {
          showDialog({ title: t('home.location_not_found_title'), message: t('home.location_not_found_body') });
          return;
        }
        const hit = hits[0];
        const next = sanitizeRegion({ latitude: hit.latitude, longitude: hit.longitude, latitudeDelta: 0.14, longitudeDelta: 0.14 });
        viewportRegionRef.current = next;
        try {
          mapRef.current?.animateToRegion(next, 850);
        } catch {}
        setSelectedEventId(null);
        setSelectedEvent(null);
        computeVisibleClusters(next);
        void fetchEventsForRegion(next);
      } catch {
        showDialog({ title: t('common.error'), message: t('home.search_error') });
      }
    },
    [computeVisibleClusters, fetchEventsForRegion, sanitizeRegion, showDialog, t, withTimeout]
  );

  useEffect(() => {
    const q = String(params?.q || '').trim();
    if (!q) return;
    setSearchText(q);
    void applyGeocode(q);
  }, [applyGeocode, params?.q]);

  const focusOnEvent = useCallback(
    (e: EventWithGeo) => {
      setSelectedEventId(e.id);
      setSelectedEvent(e);
      bumpMarkerTracking();
      const next = sanitizeRegion(__test_getFocusRegion(e._lat, e._lng));
      try {
        mapRef.current?.animateToRegion(next, 700);
      } catch {}
      Keyboard.dismiss();
    },
    [bumpMarkerTracking, sanitizeRegion]
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={[Colors.dark.background, '#12081C', Colors.dark.background]} style={StyleSheet.absoluteFill} />

      <View pointerEvents="box-none" style={[styles.topOverlay, { paddingTop: Math.max(10, insets.top) }]}>
        <GlassView intensity={16} style={styles.searchBar} contentContainerStyle={styles.searchBarContent}>
          <Search size={18} color={Colors.dark.textSecondary} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Ciudad, barrio, calle…"
            placeholderTextColor={Colors.dark.textSecondary}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            onSubmitEditing={() => void applyGeocode(searchText)}
            style={styles.searchInput}
          />
          {searchText.trim().length ? (
            <Pressable hitSlop={10} onPress={() => setSearchText('')} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 0.9 }]}>
              <X size={18} color={Colors.dark.textSecondary} />
            </Pressable>
          ) : null}
        </GlassView>
      </View>

      <View style={styles.mapContainer}>
        {locationPermission === 'loading' ? (
          <View style={styles.loading}>
            <DiscoLoader size={74} />
            <Text style={styles.loadingText}>{t('common.loading')}</Text>
          </View>
        ) : !hasMapsKey ? (
          <View style={styles.loading}>
            <GlassView intensity={18} style={styles.errorCard} contentContainerStyle={styles.errorCardContent}>
              <Text style={styles.errorTitle}>{t('home.map_unavailable_title')}</Text>
              <Text style={styles.errorBody}>{t('home.map_unavailable_body')}</Text>
            </GlassView>
          </View>
        ) : (
          <MapView
            key={`map:${mapMountKey}`}
            ref={mapRef}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            style={StyleSheet.absoluteFillObject}
            initialRegion={initialRegion}
            onMapReady={() => setMapReady(true)}
            onMapLoaded={() => setMapReady(true)}
            onRegionChangeComplete={handleRegionChangeComplete}
            showsUserLocation={locationPermission === 'granted'}
            showsMyLocationButton={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            moveOnMarkerPress={false}
            showsCompass={false}
            loadingEnabled={false}
            mapType={Platform.OS === 'ios' ? ((isDark ? 'mutedStandard' : 'standard') as any) : ('standard' as any)}
            customMapStyle={Platform.OS === 'android' ? ((isDark ? MUTED_MAP_STYLE : LIGHT_MAP_STYLE) as any) : undefined}
          >
            {mapReady ? visibleClusters.map((c) => {
              if (c.kind === 'cluster') {
                return (
                  <Marker
                    key={c.key}
                    coordinate={c.center}
                    tracksViewChanges={Platform.OS === 'android' ? trackMarkers : false}
                    onPress={() => {
                      bumpMarkerTracking();
                      setSelectedEventId(null);
                      setSelectedEvent(null);
                      const base = viewportRegionRef.current;
                      const next = sanitizeRegion({
                        latitude: c.center.latitude,
                        longitude: c.center.longitude,
                        latitudeDelta: Math.max(EVENT_FOCUS_DELTA * 1.4, base.latitudeDelta * 0.55),
                        longitudeDelta: Math.max(EVENT_FOCUS_DELTA * 1.4, base.longitudeDelta * 0.55),
                      });
                      try {
                        mapRef.current?.animateToRegion(next, 520);
                      } catch {}
                    }}
                  >
                    <ClusterBubble count={c.count} color={c.color} />
                  </Marker>
                );
              }

              const e = c.event;
              return (
                <Marker
                  key={c.key}
                  identifier={`event:${e.id}`}
                  testID={`event-marker:${e.id}`}
                  coordinate={c.center}
                  tracksViewChanges={Platform.OS === 'android' ? trackMarkers : false}
                  onPress={() => focusOnEvent(e)}
                >
                  <EventDot color={c.color} />
                </Marker>
              );
            }) : null}
          </MapView>
        )}
      </View>

      {locationPermission !== 'loading' && mapInitTimedOut && !mapReady ? (
        <View pointerEvents="none" style={[styles.loading, { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, paddingTop: 120 }]}>
          <GlassView intensity={18} style={styles.errorCard} contentContainerStyle={styles.errorCardContent}>
            <Text style={styles.errorTitle}>{t('home.map_unavailable_title')}</Text>
            <Text style={styles.errorBody}>{t('home.map_unavailable_body')}</Text>
          </GlassView>
        </View>
      ) : null}

      {selectedEvent ? (
        <Animated.View style={[styles.bottomCardWrap, { paddingBottom: tabBarHeight + 10 + Math.max(0, insets.bottom - 2) }, cardStyle]}>
          <GlassView intensity={20} style={styles.bottomCard} contentContainerStyle={styles.bottomCardContent}>
            {!!selectedEvent.imageUrl ? (
              <Image source={{ uri: selectedEvent.imageUrl }} style={styles.bottomImage} resizeMode="cover" />
            ) : (
              <View style={styles.bottomImage} />
            )}
            <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
              <Text style={styles.bottomTitle} numberOfLines={1}>{selectedEvent.title}</Text>
              <View style={styles.bottomRow}>
                <View style={[styles.pill, { flex: 1, minWidth: 0 }]}>
                  <MapPin size={14} color={Colors.dark.textSecondary} />
                  <Text style={[styles.pillText, { flexShrink: 1 }]} numberOfLines={1}>{selectedEvent.location}</Text>
                </View>
                <View style={styles.pricePill}>
                  <Text style={styles.priceText} numberOfLines={1}>{formatPriceEUR(selectedEvent.price)}</Text>
                </View>
              </View>
              <View style={styles.bottomRow}>
                <View style={styles.pill}>
                  <Calendar size={14} color={Colors.dark.textSecondary} />
                  <Text style={styles.pillText} numberOfLines={1}>{selectedEvent.date} · {selectedEvent.time}</Text>
                </View>
                <View style={styles.pillMuted}>
                  <Text style={styles.pillText}>{selectedEvent._distanceKm.toFixed(1)} km</Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <Pressable onPress={() => setSelectedEventId(null)} style={({ pressed }) => [styles.actionBtnGhost, { opacity: pressed ? 0.75 : 1 }]}>
                  <Text style={styles.actionBtnGhostText}>Cerrar</Text>
                </Pressable>
                <Pressable onPress={() => router.push(`/(tabs)/event/${selectedEvent.id}`)} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
                  <LinearGradient colors={[Colors.dark.primary, Colors.dark.secondary]} style={styles.actionBtn}>
                    <Text style={styles.actionBtnText}>Ver detalle</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </GlassView>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  topOverlay: { position: 'absolute', left: 16, right: 16, zIndex: 30 },

  searchBar: { borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(10, 10, 16, 0.82)' },
  searchBarContent: { paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, color: 'white', fontWeight: '800', paddingVertical: 0, fontSize: 15, letterSpacing: -0.2, height: 34 },

  mapContainer: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18 },
  loadingText: { color: Colors.dark.textSecondary, fontWeight: '700' },
  errorCard: { width: '100%', maxWidth: 560, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(10,10,16,0.70)' },
  errorCardContent: { padding: 18, gap: 10 },
  errorTitle: { color: 'white', fontWeight: '900', fontSize: 18, textAlign: 'center' },
  errorBody: { color: Colors.dark.textSecondary, fontWeight: '700', lineHeight: 20, textAlign: 'center' },

  eventDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    backgroundColor: 'rgba(15, 15, 26, 0.70)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  clusterBubble: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    backgroundColor: 'rgba(15, 15, 26, 0.75)',
  },
  clusterText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  bottomCardWrap: { position: 'absolute', left: 16, right: 16, bottom: 0, zIndex: 20 },
  bottomCard: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(10,10,16,0.80)' },
  bottomCardContent: { flexDirection: 'row', gap: 12, padding: 12, alignItems: 'center' },
  bottomImage: { width: 86, height: 116, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)' },
  bottomTitle: { color: 'white', fontWeight: '900', fontSize: 16, letterSpacing: -0.3 },
  bottomRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  pill: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  pillMuted: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  pillText: { color: '#E4E4E7', fontWeight: '800', fontSize: 12 },
  pricePill: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: 'rgba(124,58,237,0.92)' },
  priceText: { color: 'white', fontWeight: '900', fontSize: 12, letterSpacing: -0.2 },
  actionsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 2 },
  actionBtnGhost: { height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  actionBtnGhostText: { color: 'white', fontWeight: '900', fontSize: 13 },
  actionBtn: { height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  actionBtnText: { color: 'white', fontWeight: '900', fontSize: 13, letterSpacing: -0.2 },
});
