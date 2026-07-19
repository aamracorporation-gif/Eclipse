import { Component, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, StyleSheet, Pressable, StatusBar, Platform,
  Image, TextInput, Keyboard, FlatList, TouchableOpacity, Animated as RNAnimated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import MapView, { Marker, Region } from '@/components/ui/Map';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import type { AppEvent } from '@/lib/EventContext';
import { router, useLocalSearchParams } from 'expo-router';
import { Search, X, MapPin, Calendar, Flame, Music, Sparkles, Tag } from '@/lib/icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, withTiming,
  FadeIn, FadeOut, SlideInDown, SlideOutDown,
} from 'react-native-reanimated';
import { PROVIDER_GOOGLE } from 'react-native-maps';
import Constants from 'expo-constants';

// ─── Types ──────────────────────────────────────────────────────────────────
type EventWithGeo = AppEvent & { _lat: number; _lng: number; _distanceKm: number };
type ClusterItem =
  | { kind: 'cluster'; key: string; center: { latitude: number; longitude: number }; count: number; color: string }
  | { kind: 'event';   key: string; center: { latitude: number; longitude: number }; event: EventWithGeo; color: string };

// ─── Constants ───────────────────────────────────────────────────────────────
const VIEWPORT_DEBOUNCE_MS = 400;
const EVENT_FOCUS_DELTA = 0.03;
const MAX_MARKERS_RENDERED = 80;   // lower = stable on low-end devices
const FETCH_HORIZON_DAYS = 60;
const MAX_EVENTS_CACHE = 1500;
const MAX_EVENT_CACHE_AGE_MS = 1000 * 60 * 25;

// ─── Map styles ──────────────────────────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: 'geometry',         stylers: [{ color: '#0B0B14' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9CA3AF' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0B0B14' }] },
  { featureType: 'poi',    elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road',   elementType: 'geometry', stylers: [{ color: '#151528' }] },
  { featureType: 'road',   elementType: 'geometry.stroke', stylers: [{ color: '#1E1E3A' }] },
  { featureType: 'road',   elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water',  elementType: 'geometry', stylers: [{ color: '#060D1A' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2D2D5E' }] },
];

// ─── Event type config ───────────────────────────────────────────────────────
const EVENT_TYPES = [
  { key: 'all',      label: 'Todo',      color: '#FFFFFF', Icon: Sparkles },
  { key: 'party',    label: 'Fiesta',    color: '#A78BFA', Icon: Flame },
  { key: 'concert',  label: 'Concierto', color: '#38BDF8', Icon: Music },
  { key: 'festival', label: 'Festival',  color: '#FB923C', Icon: Sparkles },
  { key: 'other',    label: 'Otro',      color: '#34D399', Icon: Tag },
];

function getEventColor(eventType?: string | null): string {
  const t = String(eventType || '').toLowerCase();
  if (t.includes('concert') || t.includes('concierto')) return '#38BDF8';
  if (t.includes('festival')) return '#FB923C';
  if (t.includes('party')   || t.includes('fiesta'))   return '#A78BFA';
  if (t.includes('techno'))  return '#EC4899';
  return '#34D399';
}

// ─── Error boundary ───────────────────────────────────────────────────────────
class MapErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[PartyMap] 🔴 MapErrorBoundary caught error:', error?.message || error);
    console.error('[PartyMap] 🔴 Stack trace:', error?.stack || '(no stack)');
    console.error('[PartyMap] 🔴 Component stack:', info?.componentStack || '(no componentStack)');
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ─── Memoized marker components ───────────────────────────────────────────────
const ClusterBubble = memo(({ count, color }: { count: number; color: string }) => (
  <View style={[styles.clusterBubble, { borderColor: color + 'CC' }]}>
    <View style={[styles.clusterInner, { backgroundColor: color + '22' }]}>
      <Text style={[styles.clusterText, { color }]}>{count}</Text>
    </View>
  </View>
));
ClusterBubble.displayName = 'ClusterBubble';

const EVENT_EMOJI: Record<string, string> = {
  party: '🎉', fiesta: '🎉',
  concert: '🎤', concierto: '🎤',
  festival: '🎪',
  techno: '🎛️',
  other: '✨', otro: '✨',
};
function getEventEmoji(eventType?: string | null): string {
  const t = String(eventType || '').toLowerCase();
  for (const [k, v] of Object.entries(EVENT_EMOJI)) { if (t.includes(k)) return v; }
  return '🎉';
}

const EventPin = memo(({ color, selected, eventType }: { color: string; selected: boolean; eventType?: string | null }) => {
  const pulse = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    // Only animate pulse ring when selected — avoids 80 concurrent animation loops
    if (!selected) { pulse.setValue(0); return; }
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, selected]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, selected ? 1.7 : 1.55] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.55, 0.15, 0] });
  const emoji = getEventEmoji(eventType);
  const scale = selected ? 1.25 : 1;

  return (
    <View style={[styles.pinWrap, { transform: [{ scale }] }]}>
      {/* Pulse ring */}
      <RNAnimated.View style={[
        styles.pinPulse,
        { borderColor: color, transform: [{ scale: pulseScale }], opacity: pulseOpacity },
      ]} />
      {/* Glow halo */}
      <View style={[styles.pinHalo, { backgroundColor: color + '30', shadowColor: color }]} />
      {/* Main badge */}
      <View style={[styles.pinBadge, { backgroundColor: '#111127', borderColor: selected ? color : color + '90', shadowColor: color }]}>
        <View style={[styles.pinBadgeInner, { backgroundColor: color + '25' }]}>
          <Text style={styles.pinEmoji}>{emoji}</Text>
        </View>
      </View>
      {/* Tail */}
      <View style={[styles.pinTailOuter, { borderTopColor: selected ? color : color + '90' }]} />
    </View>
  );
});
EventPin.displayName = 'EventPin';

// ─── Clustering logic ─────────────────────────────────────────────────────────
export function __test_clusterForRegion(
  list: EventWithGeo[], r: Region,
  getColor: (t?: string | null) => string,
): ClusterItem[] {
  const tryCluster = (mult: number) => {
    const latStep = Math.max(0.003, (r.latitudeDelta / 12) * mult);
    const lngStep = Math.max(0.003, (r.longitudeDelta / 12) * mult);
    const buckets = new Map<string, EventWithGeo[]>();
    for (const e of list) {
      const key = `${Math.floor(e._lat / latStep)}:${Math.floor(e._lng / lngStep)}`;
      const arr = buckets.get(key);
      if (arr) arr.push(e); else buckets.set(key, [e]);
    }
    return buckets;
  };

  let mult = 1;
  let buckets = tryCluster(mult);
  while (buckets.size > MAX_MARKERS_RENDERED && mult < 16) {
    mult *= 1.4;
    buckets = tryCluster(mult);
  }

  const out: ClusterItem[] = [];
  for (const [bk, items] of buckets.entries()) {
    if (items.length === 1) {
      const e = items[0];
      out.push({ kind: 'event', key: `e:${e.id}`, center: { latitude: e._lat, longitude: e._lng }, event: e, color: getColor(e.eventType) });
    } else {
      const avgLat = items.reduce((s, i) => s + i._lat, 0) / items.length;
      const avgLng = items.reduce((s, i) => s + i._lng, 0) / items.length;
      out.push({ kind: 'cluster', key: `c:${bk}`, center: { latitude: avgLat, longitude: avgLng }, count: items.length, color: getColor(items[0]?.eventType) });
    }
  }
  return out.sort((a, b) => (b.kind === 'cluster' ? b.count : 1) - (a.kind === 'cluster' ? a.count : 1));
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PartyMapScreen() {
  const { t } = useTranslation();
  const insets   = useSafeAreaInsets();
  const tabBarH  = useBottomTabBarHeight();
  const params   = useLocalSearchParams<{ q?: string }>();

  const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL     || '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const mapsApiKey      = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const hasMapsKey      =
    Platform.OS !== 'android' ||
    (Constants as any)?.appOwnership === 'expo' ||
    (!!mapsApiKey && !mapsApiKey.includes('TU_CLAVE_API'));

  // ── Map refs & state ────────────────────────────────────────────────────────
  const mapRef             = useRef<MapView>(null);
  const mapMountKeyRef     = useRef(0);
  const [mapMountKey,   setMapMountKey]   = useState(0);
  const [mapReady,      setMapReady]      = useState(false);
  const [mapCrashed,    setMapCrashed]    = useState(false);
  const mapEverReadyRef    = useRef(false);
  const mapInitTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapTimedOut,   setMapTimedOut]   = useState(false);

  // ── Location ─────────────────────────────────────────────────────────────────
  const [locPerm, setLocPerm] = useState<'loading' | 'granted' | 'denied'>('loading');
  const DEFAULT_REGION: Region = { latitude: 40.4168, longitude: -3.7038, latitudeDelta: 0.12, longitudeDelta: 0.12 };
  const [initialRegion, setInitialRegion] = useState<Region>(DEFAULT_REGION);
  const viewportRef = useRef<Region>(DEFAULT_REGION);

  // ── Events cache ─────────────────────────────────────────────────────────────
  const allEventsRef    = useRef<Map<string, EventWithGeo & { _seenAt: number }>>(new Map());
  const fetchAbortRef   = useRef<AbortController | null>(null);
  const fetchSeqRef     = useRef(0);
  const lastBboxKeyRef  = useRef('');
  const lastFetchAtRef  = useRef(0);
  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Clusters & selection ──────────────────────────────────────────────────────
  const [visibleClusters, setVisibleClusters]   = useState<ClusterItem[]>([]);
  const lastSigRef = useRef('');
  const [selectedEvent, setSelectedEvent]       = useState<EventWithGeo | null>(null);
  const [selectedId,    setSelectedId]          = useState<string | null>(null);

  // ── Search ───────────────────────────────────────────────────────────────────
  const [searchText,       setSearchText]       = useState('');
  const [searchFocused,    setSearchFocused]    = useState(false);
  const [searchResults,    setSearchResults]    = useState<EventWithGeo[]>([]);
  const [activeFilter,     setActiveFilter]     = useState('all');

  // ── Animations ────────────────────────────────────────────────────────────────
  const cardOpacity = useSharedValue(0);
  const cardY       = useSharedValue(24);
  const cardStyle   = useAnimatedStyle(() => ({
    opacity:   cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  const sanitizeRegion = useCallback((r: Region): Region => ({
    latitude:      clamp(Number.isFinite(Number(r?.latitude))      ? Number(r.latitude)      : 40.4168, -85, 85),
    longitude:     clamp(Number.isFinite(Number(r?.longitude))     ? Number(r.longitude)     : -3.7038, -180, 180),
    latitudeDelta: clamp(Number.isFinite(Number(r?.latitudeDelta)) ? Number(r.latitudeDelta) : 0.12, 0.002, 2.5),
    longitudeDelta:clamp(Number.isFinite(Number(r?.longitudeDelta))? Number(r.longitudeDelta): 0.12, 0.002, 2.5),
  }), []);

  const haversineKm = useCallback((lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371, dL = ((lat2 - lat1) * Math.PI) / 180, dO = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dO/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, []);

  const formatPrice = useCallback((raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return `${raw}€`;
    return n === 0 ? 'Gratis' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
  }, []);

  const withTimeout = useCallback(<T,>(p: Promise<T>, ms: number): Promise<T> => {
    let id: ReturnType<typeof setTimeout>;
    return Promise.race([p, new Promise<T>((_, rej) => { id = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(id));
  }, []);

  // ─── Search matching ─────────────────────────────────────────────────────────
  const updateSearchResults = useCallback((text: string, filter: string) => {
    const q = text.trim().toLowerCase();
    const all = Array.from(allEventsRef.current.values());
    if (!q && filter === 'all') { setSearchResults([]); return; }

    const filtered = all.filter(e => {
      const typeMatch = filter === 'all' || (e.eventType || 'party').toLowerCase().includes(filter);
      const textMatch = !q || [e.title, e.location, e.description, e.eventType]
        .some(f => (f || '').toLowerCase().includes(q));
      return typeMatch && textMatch;
    }).sort((a, b) => a._distanceKm - b._distanceKm).slice(0, 12);

    setSearchResults(filtered);
  }, []);

  useEffect(() => {
    updateSearchResults(searchText, activeFilter);
  }, [searchText, activeFilter, updateSearchResults]);

  // ─── Clusters ────────────────────────────────────────────────────────────────
  const computeClusters = useCallback((region: Region) => {
    const all = Array.from(allEventsRef.current.values());
    const pad = 0.6;
    const minLat = region.latitude - region.latitudeDelta * (0.5 + pad);
    const maxLat = region.latitude + region.latitudeDelta * (0.5 + pad);
    const minLng = region.longitude - region.longitudeDelta * (0.5 + pad);
    const maxLng = region.longitude + region.longitudeDelta * (0.5 + pad);

    // Apply active filter
    const visible = all.filter(e =>
      e._lat >= minLat && e._lat <= maxLat &&
      e._lng >= minLng && e._lng <= maxLng &&
      (activeFilter === 'all' || (e.eventType || 'party').toLowerCase().includes(activeFilter))
    );

    const clustered = __test_clusterForRegion(visible, region, getEventColor);
    const sig = clustered.slice(0, 60).map(c => c.kind === 'cluster' ? `${c.key}:${c.count}` : c.key).join('|');
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;
    setVisibleClusters(clustered);
  }, [activeFilter]);

  // ─── Fetch ───────────────────────────────────────────────────────────────────
  const fetchForRegion = useCallback(async (region: Region) => {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const safe = sanitizeRegion(region);
    const pad = 0.85;
    const minLat = safe.latitude - safe.latitudeDelta * (0.5 + pad);
    const maxLat = safe.latitude + safe.latitudeDelta * (0.5 + pad);
    const minLng = safe.longitude - safe.longitudeDelta * (0.5 + pad);
    const maxLng = safe.longitude + safe.longitudeDelta * (0.5 + pad);

    const bboxKey = `${minLat.toFixed(3)}|${maxLat.toFixed(3)}|${minLng.toFixed(3)}|${maxLng.toFixed(3)}`;
    if (bboxKey === lastBboxKeyRef.current && Date.now() - lastFetchAtRef.current < 12000) return;

    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;
    const seq = ++fetchSeqRef.current;
    lastBboxKeyRef.current = bboxKey;

    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const fromIso = todayStart.toISOString();
      const toIso   = new Date(todayStart.getTime() + 86400000 * FETCH_HORIZON_DAYS).toISOString();
      const sel = 'id,title,description,poster_url,event_date,ticket_price,available_tickets,sold_tickets,event_type,creator_id,updated_at,venues!inner(name,latitude,longitude)';
      const url =
        `${supabaseUrl.replace(/\/$/, '')}/rest/v1/events` +
        `?select=${encodeURIComponent(sel)}&order=event_date.asc` +
        `&event_date=gte.${encodeURIComponent(fromIso)}&event_date=lte.${encodeURIComponent(toIso)}` +
        `&venues.latitude=gte.${minLat}&venues.latitude=lte.${maxLat}` +
        `&venues.longitude=gte.${minLng}&venues.longitude=lte.${maxLng}`;

      const res = await withTimeout(fetch(url, { signal: ctrl.signal, headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } }), 10000);
      if (seq !== fetchSeqRef.current) return;
      if (!res.ok) return;
      const remote = await res.json();
      if (!Array.isArray(remote)) return;

      const now = Date.now();
      const pad2 = (n: number) => String(n).padStart(2, '0');
      for (const raw of remote) {
        const id = String(raw?.id || ''); if (!id) continue;
        const venue = raw?.venues || {};
        const lat = Number(venue.latitude), lng = Number(venue.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const d = new Date(raw.event_date);
        const prev = allEventsRef.current.get(id);
        if (!prev || (raw.updated_at && prev.updatedAt !== raw.updated_at)) {
          allEventsRef.current.set(id, {
            id, title: String(raw.title || ''),
            startsAt: raw.event_date, updatedAt: raw.updated_at || null,
            date: `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`,
            time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
            location: String(venue.name || 'Sin ubicación'),
            price: String(raw.ticket_price ?? '0'),
            capacity: Number(raw.available_tickets ?? 0),
            sold: Number(raw.sold_tickets ?? 0),
            imageUrl: String(raw.poster_url || ''),
            description: String(raw.description || ''),
            eventType: String(raw.event_type || 'party').trim(),
            creatorId: raw.creator_id,
            ticketTypes: [],
            venues: { latitude: lat, longitude: lng, name: String(venue.name || '') },
            _lat: lat, _lng: lng,
            _distanceKm: haversineKm(safe.latitude, safe.longitude, lat, lng),
            _seenAt: now,
          } as any);
        } else { prev._seenAt = now; }
      }

      // Prune old entries
      const cutoff = now - MAX_EVENT_CACHE_AGE_MS;
      for (const [id, e] of allEventsRef.current.entries()) {
        if ((e as any)._seenAt < cutoff) allEventsRef.current.delete(id);
      }
      if (allEventsRef.current.size > MAX_EVENTS_CACHE) {
        const sorted = [...allEventsRef.current.entries()].sort((a, b) => (a[1] as any)._seenAt - (b[1] as any)._seenAt);
        sorted.slice(0, sorted.length - MAX_EVENTS_CACHE).forEach(([id]) => allEventsRef.current.delete(id));
      }

      lastFetchAtRef.current = now;
      computeClusters(safe);
      updateSearchResults(searchText, activeFilter);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('[PartyMap] 🔴 Fetch error:', e?.message || e);
        computeClusters(safe);
      }
    }
  }, [supabaseUrl, supabaseAnonKey, sanitizeRegion, withTimeout, haversineKm, computeClusters, updateSearchResults, searchText, activeFilter]);

  // ─── Location permission ──────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const perm = await withTimeout(Location.requestForegroundPermissionsAsync(), 6000);
        if (!mounted) return;
        if (perm.status !== 'granted') { setLocPerm('denied'); return; }
        setLocPerm('granted');
        const pos = await withTimeout(Location.getCurrentPositionAsync({}), 8000);
        if (!mounted) return;
        const next = sanitizeRegion({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.10, longitudeDelta: 0.10 });
        viewportRef.current = next;
        setInitialRegion(next);
        try { mapRef.current?.animateToRegion(next, 600); } catch {}
      } catch { if (mounted) setLocPerm('denied'); }
    })();
    return () => { mounted = false; };
  }, [sanitizeRegion, withTimeout]);

  // ─── Map init timeout ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (locPerm === 'loading' || !hasMapsKey) return;
    if (mapEverReadyRef.current) return;
    mapInitTimerRef.current = setTimeout(() => {
      if (!mapEverReadyRef.current) {
        console.warn('[PartyMap] ⏱ Map never fired onMapReady after 14s — remounting (key:', mapMountKeyRef.current + 1, '). Platform:', Platform.OS, 'hasMapsKey:', hasMapsKey);
        setMapTimedOut(true);
        setMapCrashed(false);
        setMapMountKey(k => { mapMountKeyRef.current = k + 1; return k + 1; });
      }
    }, 14000);
    return () => { if (mapInitTimerRef.current) clearTimeout(mapInitTimerRef.current); };
  }, [locPerm, hasMapsKey, mapMountKey]);

  useEffect(() => {
    if (!mapReady) return;
    mapEverReadyRef.current = true;
    setMapTimedOut(false);
    if (mapInitTimerRef.current) clearTimeout(mapInitTimerRef.current);
    computeClusters(viewportRef.current);
    void fetchForRegion(viewportRef.current);
  }, [mapReady, computeClusters, fetchForRegion]);

  // ─── Region change ────────────────────────────────────────────────────────────
  const onRegionChangeComplete = useCallback((r: Region) => {
    const next = sanitizeRegion(r);
    viewportRef.current = next;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      computeClusters(next);
      void fetchForRegion(next);
    }, VIEWPORT_DEBOUNCE_MS);
  }, [computeClusters, fetchForRegion, sanitizeRegion]);

  // ─── Selection animation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedEvent) {
      cardOpacity.value = withTiming(0, { duration: 160 });
      cardY.value       = withTiming(24, { duration: 160 });
    } else {
      cardOpacity.value = withTiming(1, { duration: 240 });
      cardY.value       = withSpring(0, { damping: 20, stiffness: 280, mass: 0.8 });
    }
  }, [selectedEvent, cardOpacity, cardY]);

  // ─── Focus on event ───────────────────────────────────────────────────────────
  const focusOnEvent = useCallback((e: EventWithGeo) => {
    setSelectedId(e.id);
    setSelectedEvent(e);
    setSearchFocused(false);
    Keyboard.dismiss();
    const next = sanitizeRegion({ latitude: e._lat, longitude: e._lng, latitudeDelta: EVENT_FOCUS_DELTA, longitudeDelta: EVENT_FOCUS_DELTA });
    try { mapRef.current?.animateToRegion(next, 650); } catch {}
  }, [sanitizeRegion]);

  // ─── Geocode search ───────────────────────────────────────────────────────────
  const geocodeSearch = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text) return;
    Keyboard.dismiss();
    setSearchFocused(false);
    try {
      const hits = await withTimeout(Location.geocodeAsync(text), 8000);
      if (!hits?.length) return;
      const next = sanitizeRegion({ latitude: hits[0].latitude, longitude: hits[0].longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 });
      viewportRef.current = next;
      try { mapRef.current?.animateToRegion(next, 800); } catch {}
      computeClusters(next);
      void fetchForRegion(next);
    } catch {}
  }, [sanitizeRegion, computeClusters, fetchForRegion, withTimeout]);

  // ─── Deep-link q param ───────────────────────────────────────────────────────
  useEffect(() => {
    const q = String(params?.q || '').trim();
    if (!q) return;
    setSearchText(q);
    void geocodeSearch(q);
  }, [params?.q, geocodeSearch]);

  // ─── Global error logger (scoped to this screen mount) ───────────────────────
  useEffect(() => {
    const prev = (global as any).ErrorUtils?.getGlobalHandler?.();
    (global as any).ErrorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
      console.error(`[PartyMap] 🔴 GLOBAL JS ERROR (fatal=${isFatal}):`, error?.message || error);
      console.error('[PartyMap] 🔴 Global error stack:', error?.stack || '(no stack)');
      if (prev) prev(error, isFatal);
    });
    console.log('[PartyMap] ✅ Screen mounted. Platform:', Platform.OS, '| hasMapsKey:', hasMapsKey);
    return () => {
      console.log('[PartyMap] 🔕 Screen unmounting — restoring error handler');
      if (prev) (global as any).ErrorUtils?.setGlobalHandler?.(prev);
    };
  }, [hasMapsKey]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (debounceRef.current)  clearTimeout(debounceRef.current);
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
  }, []);

  // ─── Recompute on filter change ───────────────────────────────────────────────
  useEffect(() => {
    computeClusters(viewportRef.current);
  }, [activeFilter, computeClusters]);

  // ─── Render ───────────────────────────────────────────────────────────────────
  const showResults = searchFocused && (searchText.trim().length > 0 || activeFilter !== 'all');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ── Map layer ── */}
      <View style={StyleSheet.absoluteFill}>
        {locPerm === 'loading' ? (
          <View style={styles.center}>
            <DiscoLoader size={74} />
            <Text style={styles.loadingTxt}>Cargando mapa…</Text>
          </View>
        ) : !hasMapsKey ? (
          <View style={styles.center}>
            <Text style={styles.errTitle}>Mapa no disponible</Text>
          </View>
        ) : mapCrashed ? (
          <View style={styles.center}>
            <Text style={styles.errTitle}>Error al cargar el mapa</Text>
            <TouchableOpacity onPress={() => { setMapCrashed(false); setMapReady(false); setMapMountKey(k => k + 1); }} style={styles.retryBtn}>
              <Text style={styles.retryTxt}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <MapErrorBoundary onError={() => {
            console.error('[PartyMap] 🔴 MapErrorBoundary triggered onError — marking crashed. mountKey:', mapMountKeyRef.current);
            setMapCrashed(true); setMapReady(false);
          }}>
            <MapView
              key={`map:${mapMountKey}`}
              ref={mapRef}
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              style={StyleSheet.absoluteFillObject}
              initialRegion={initialRegion}
              onMapReady={() => { console.log('[PartyMap] ✅ onMapReady fired. mountKey:', mapMountKeyRef.current); setMapReady(true); }}
              onMapLoaded={() => { console.log('[PartyMap] ✅ onMapLoaded fired.'); setMapReady(true); }}
              onRegionChangeComplete={onRegionChangeComplete}
              showsUserLocation={locPerm === 'granted'}
              showsMyLocationButton={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              moveOnMarkerPress={false}
              showsCompass={false}
              loadingEnabled={false}
              // tracksViewChanges is explicitly NEVER set to true on markers
              // (known Android crash source) — each marker handles it individually
              mapType="standard"
              customMapStyle={Platform.OS === 'android' ? (DARK_MAP_STYLE as any) : undefined}
            >
              {mapReady && visibleClusters.map(c => {
                if (c.kind === 'cluster') {
                  return (
                    <Marker
                      key={c.key}
                      coordinate={c.center}
                      tracksViewChanges={false}
                      onPress={() => {
                        setSelectedId(null); setSelectedEvent(null);
                        const base = viewportRef.current;
                        const next = sanitizeRegion({
                          latitude: c.center.latitude, longitude: c.center.longitude,
                          latitudeDelta: Math.max(EVENT_FOCUS_DELTA * 1.5, base.latitudeDelta * 0.5),
                          longitudeDelta: Math.max(EVENT_FOCUS_DELTA * 1.5, base.longitudeDelta * 0.5),
                        });
                        try { mapRef.current?.animateToRegion(next, 480); } catch {}
                      }}
                    >
                      <ClusterBubble count={c.count} color={c.color} />
                    </Marker>
                  );
                }
                const e = c.event;
                const isSel = selectedId === e.id;
                return (
                  <Marker
                    key={c.key}
                    identifier={`event:${e.id}`}
                    coordinate={c.center}
                    tracksViewChanges={false}
                    onPress={() => focusOnEvent(e)}
                  >
                    <EventPin color={c.color} selected={isSel} eventType={e.eventType} />
                  </Marker>
                );
              })}
            </MapView>
          </MapErrorBoundary>
        )}
      </View>

      {/* ── Top: search + filters ── */}
      <View style={[styles.topOverlay, { paddingTop: Math.max(12, insets.top) }]}>
        {/* Search bar */}
        <GlassView intensity={20} style={styles.searchBar}>
          <View style={styles.searchRow}>
            <Search size={18} color="rgba(255,255,255,0.5)" />
            <TextInput
              value={searchText}
              onChangeText={t => { setSearchText(t); setSearchFocused(true); }}
              onFocus={() => setSearchFocused(true)}
              placeholder="Busca eventos, ciudades, barrios…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              onSubmitEditing={() => void geocodeSearch(searchText)}
              style={styles.searchInput}
            />
            {searchText.length > 0 && (
              <Pressable hitSlop={10} onPress={() => { setSearchText(''); setSearchFocused(false); setSearchResults([]); }}>
                <X size={18} color="rgba(255,255,255,0.5)" />
              </Pressable>
            )}
          </View>
        </GlassView>

        {/* Filter chips */}
        <View style={styles.filterRow}>
          {EVENT_TYPES.map(({ key, label, color, Icon }) => {
            const active = activeFilter === key;
            return (
              <Pressable
                key={key}
                onPress={() => setActiveFilter(key)}
                style={[styles.filterChip, active && { backgroundColor: color + '30', borderColor: color + 'CC' }]}
              >
                <Icon size={12} color={active ? color : 'rgba(255,255,255,0.5)'} />
                <Text style={[styles.filterChipTxt, active && { color }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Dynamic search results */}
        {showResults && searchResults.length > 0 && (
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.resultsPanel}>
            <FlatList
              data={searchResults}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={styles.resultSep} />}
              renderItem={({ item }) => {
                const color = getEventColor(item.eventType);
                return (
                  <TouchableOpacity
                    activeOpacity={0.75}
                    style={styles.resultRow}
                    onPress={() => focusOnEvent(item)}
                  >
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.resultImg} />
                    ) : (
                      <View style={[styles.resultImg, { backgroundColor: color + '30' }]}>
                        <View style={[styles.resultImgDot, { backgroundColor: color }]} />
                      </View>
                    )}
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                      <View style={styles.resultMeta}>
                        <MapPin size={11} color="rgba(255,255,255,0.45)" />
                        <Text style={styles.resultMetaTxt} numberOfLines={1}>{item.location}</Text>
                        <Text style={[styles.resultDist, { color }]}>{item._distanceKm.toFixed(1)} km</Text>
                      </View>
                    </View>
                    <View style={[styles.resultPriceBadge, { backgroundColor: color + '28' }]}>
                      <Text style={[styles.resultPrice, { color }]}>{formatPrice(item.price)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </Animated.View>
        )}

        {showResults && searchResults.length === 0 && searchText.trim().length > 1 && (
          <Animated.View entering={FadeIn.duration(180)} style={styles.noResults}>
            <Text style={styles.noResultsTxt}>Sin resultados para "{searchText}"</Text>
            <TouchableOpacity onPress={() => void geocodeSearch(searchText)}>
              <Text style={styles.noResultsSearch}>Buscar ubicación →</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>

      {/* ── Dismiss results overlay ── */}
      {searchFocused && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => { setSearchFocused(false); Keyboard.dismiss(); }}
          pointerEvents="box-only"
        />
      )}

      {/* ── Event detail card ── */}
      {selectedEvent && (
        <Animated.View
          style={[styles.cardWrap, { paddingBottom: tabBarH + 10 + Math.max(0, insets.bottom - 2) }, cardStyle]}
          entering={SlideInDown.springify().damping(20).stiffness(260)}
          exiting={SlideOutDown.duration(180)}
        >
          <GlassView intensity={22} style={styles.card}>
            {selectedEvent.imageUrl ? (
              <Image source={{ uri: selectedEvent.imageUrl }} style={styles.cardImg} />
            ) : (
              <View style={[styles.cardImg, { backgroundColor: getEventColor(selectedEvent.eventType) + '28' }]} />
            )}
            <View style={styles.cardBody}>
              {/* Type badge */}
              <View style={[styles.typeBadge, { backgroundColor: getEventColor(selectedEvent.eventType) + '28' }]}>
                <Text style={[styles.typeBadgeTxt, { color: getEventColor(selectedEvent.eventType) }]}>
                  {(selectedEvent.eventType || 'Evento').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>{selectedEvent.title}</Text>
              <View style={styles.cardMetaRow}>
                <MapPin size={12} color="rgba(255,255,255,0.5)" />
                <Text style={styles.cardMeta} numberOfLines={1}>{selectedEvent.location}</Text>
              </View>
              <View style={styles.cardMetaRow}>
                <Calendar size={12} color="rgba(255,255,255,0.5)" />
                <Text style={styles.cardMeta}>{selectedEvent.date} · {selectedEvent.time}</Text>
                <Text style={[styles.cardDist, { color: getEventColor(selectedEvent.eventType) }]}>
                  {selectedEvent._distanceKm.toFixed(1)} km
                </Text>
              </View>
              <View style={styles.cardActions}>
                <Pressable
                  onPress={() => { setSelectedId(null); setSelectedEvent(null); }}
                  style={({ pressed }) => [styles.btnClose, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={styles.btnCloseTxt}>Cerrar</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/(tabs)/event/${selectedEvent.id}`)}
                  style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, flex: 1 }]}
                >
                  <LinearGradient
                    colors={[Colors.dark.primary, Colors.dark.secondary]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.btnDetail}
                  >
                    <Text style={styles.btnDetailTxt}>{formatPrice(selectedEvent.price)} · Ver evento</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </GlassView>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#08080F' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  loadingTxt:{ color: 'rgba(255,255,255,0.5)', fontWeight: '700', marginTop: 8 },
  errTitle:  { color: 'white', fontWeight: '900', fontSize: 18, textAlign: 'center' },
  retryBtn:  { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: Colors.dark.primary + '30', borderWidth: 1, borderColor: Colors.dark.primary + '60' },
  retryTxt:  { color: Colors.dark.primary, fontWeight: '900', fontSize: 14 },

  // ── Top overlay ──
  topOverlay: { position: 'absolute', left: 14, right: 14, zIndex: 40 },

  searchBar: {
    borderRadius: 22, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(8,8,15,0.88)',
    overflow: 'hidden',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  searchInput: { flex: 1, color: 'white', fontWeight: '700', fontSize: 15, paddingVertical: 0, letterSpacing: -0.2 },

  filterRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'nowrap' },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  filterChipTxt: { color: 'rgba(255,255,255,0.5)', fontWeight: '800', fontSize: 11 },

  // ── Search results ──
  resultsPanel: {
    marginTop: 8, borderRadius: 18, overflow: 'hidden',
    backgroundColor: 'rgba(10,10,20,0.96)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    maxHeight: 340,
  },
  resultSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 14 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  resultImg: { width: 50, height: 50, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  resultImgDot: { width: 16, height: 16, borderRadius: 8 },
  resultInfo: { flex: 1, gap: 4 },
  resultTitle: { color: 'white', fontWeight: '800', fontSize: 14 },
  resultMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resultMetaTxt: { color: 'rgba(255,255,255,0.45)', fontSize: 12, flex: 1 },
  resultDist: { fontSize: 12, fontWeight: '800' },
  resultPriceBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  resultPrice: { fontWeight: '900', fontSize: 12 },

  noResults: {
    marginTop: 8, borderRadius: 16, padding: 16,
    backgroundColor: 'rgba(10,10,20,0.94)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', gap: 6,
  },
  noResultsTxt:   { color: 'rgba(255,255,255,0.5)', fontWeight: '700', fontSize: 13 },
  noResultsSearch:{ color: Colors.dark.primary, fontWeight: '900', fontSize: 13 },

  // ── Map markers ──
  pinWrap:      { alignItems: 'center', justifyContent: 'center' },
  pinPulse:     { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 2 },
  pinHalo:      { position: 'absolute', width: 38, height: 38, borderRadius: 19, shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  pinBadge:     { width: 42, height: 42, borderRadius: 14, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 8 },
  pinBadgeInner:{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pinEmoji:     { fontSize: 18, lineHeight: 22 },
  pinTailOuter: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -1 },

  clusterBubble: { borderWidth: 2, borderRadius: 999, overflow: 'hidden' },
  clusterInner:  { paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  clusterText:   { fontSize: 13, fontWeight: '900', letterSpacing: -0.3 },

  // ── Event card ──
  cardWrap: { position: 'absolute', left: 14, right: 14, bottom: 0, zIndex: 30 },
  card:     { borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(8,8,15,0.90)', flexDirection: 'row' },
  cardImg:  { width: 100, height: 140 },
  cardBody: { flex: 1, padding: 14, gap: 6 },

  typeBadge:   { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginBottom: 2 },
  typeBadgeTxt:{ fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  cardTitle:    { color: 'white', fontWeight: '900', fontSize: 15, letterSpacing: -0.3, lineHeight: 20 },
  cardMetaRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMeta:     { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', flex: 1 },
  cardDist:     { fontSize: 12, fontWeight: '900' },

  cardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnClose:    { height: 40, paddingHorizontal: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  btnCloseTxt: { color: 'rgba(255,255,255,0.75)', fontWeight: '900', fontSize: 12 },
  btnDetail:   { height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnDetailTxt:{ color: 'white', fontWeight: '900', fontSize: 12, letterSpacing: -0.2 },
});
