import { Component, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, StyleSheet, Pressable, StatusBar, Platform,
  Image, TextInput, Keyboard, FlatList, TouchableOpacity, Animated as RNAnimated,
  ScrollView,
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

// ─── Types ────────────────────────────────────────────────────────────────────
type EventWithGeo = AppEvent & { _lat: number; _lng: number; _distanceKm: number };
type ClusterItem =
  | { kind: 'cluster'; key: string; center: { latitude: number; longitude: number }; count: number; color: string }
  | { kind: 'event';   key: string; center: { latitude: number; longitude: number }; event: EventWithGeo; color: string };

// ─── Constants ────────────────────────────────────────────────────────────────
const VIEWPORT_DEBOUNCE_MS  = 350;
const EVENT_FOCUS_DELTA     = 0.025;
const PRICE_ZOOM_THRESHOLD  = 0.18;   // below this latitudeDelta → show price labels (city/neighbourhood level)
const MAX_MARKERS_RENDERED  = 80;
const FETCH_HORIZON_DAYS    = 90;
const MAX_EVENTS_CACHE      = 2000;
const MAX_EVENT_CACHE_AGE_MS = 1000 * 60 * 30;

// ─── Map style ────────────────────────────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: 'geometry',           stylers: [{ color: '#0B0B14' }] },
  { elementType: 'labels.text.fill',   stylers: [{ color: '#9CA3AF' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0B0B14' }] },
  { featureType: 'poi',     elementType: 'labels',          stylers: [{ visibility: 'off' }] },
  { featureType: 'road',    elementType: 'geometry',        stylers: [{ color: '#151528' }] },
  { featureType: 'road',    elementType: 'geometry.stroke', stylers: [{ color: '#1E1E3A' }] },
  { featureType: 'road',    elementType: 'labels.icon',     stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels',          stylers: [{ visibility: 'off' }] },
  { featureType: 'water',   elementType: 'geometry',        stylers: [{ color: '#060D1A' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2D2D5E' }] },
];

// ─── Event type config ────────────────────────────────────────────────────────
const EVENT_TYPES = [
  { key: 'all',      label: 'Todo',      color: '#FFFFFF', Icon: Sparkles },
  { key: 'party',    label: 'Fiesta',    color: '#A78BFA', Icon: Flame    },
  { key: 'concert',  label: 'Concierto', color: '#38BDF8', Icon: Music    },
  { key: 'festival', label: 'Festival',  color: '#FB923C', Icon: Sparkles },
  { key: 'other',    label: 'Otro',      color: '#34D399', Icon: Tag      },
];

function getEventColor(eventType?: string | null): string {
  const t = String(eventType || '').toLowerCase();
  if (t.includes('concert')  || t.includes('concierto')) return '#38BDF8';
  if (t.includes('festival'))                             return '#FB923C';
  if (t.includes('party')    || t.includes('fiesta'))    return '#A78BFA';
  if (t.includes('techno'))                              return '#EC4899';
  return '#34D399';
}

// ─── Error boundary ───────────────────────────────────────────────────────────
class MapErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError(); }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ─── Dot marker (low zoom) ────────────────────────────────────────────────────
const EventDot = memo(({ color, selected }: { color: string; selected: boolean }) => (
  <View style={[styles.dotOuter, { borderColor: selected ? color : color + '55' }]}>
    <View style={[styles.dotInner, { backgroundColor: color, opacity: selected ? 1 : 0.85 }]} />
  </View>
));
EventDot.displayName = 'EventDot';

// ─── Price-badge marker (high zoom / selected) ────────────────────────────────
const EventPin = memo(({ color, selected, price }: { color: string; selected: boolean; price?: string }) => {
  const pulse = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (!selected) { pulse.setValue(0); return; }
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, selected]);

  const pulseScale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.2, 0] });

  const priceNum = parseFloat(String(price || '0'));
  const priceLabel = !Number.isFinite(priceNum) || priceNum <= 0
    ? 'Free'
    : priceNum < 1000 ? `${Math.round(priceNum)}€` : `${(priceNum / 1000).toFixed(1)}k€`;

  return (
    <View style={[styles.pinWrap, selected && styles.pinWrapSelected]}>
      {selected && (
        <RNAnimated.View style={[
          styles.pinPulse,
          { borderColor: color, transform: [{ scale: pulseScale }], opacity: pulseOpacity },
        ]} />
      )}
      <View style={[
        styles.pinBadge,
        { backgroundColor: selected ? color : '#111127', borderColor: color, shadowColor: color },
      ]}>
        <Text style={[styles.pinPrice, { color: selected ? '#fff' : color }]} numberOfLines={1}>
          {priceLabel}
        </Text>
      </View>
      <View style={[styles.pinTailOuter, { borderTopColor: color }]} />
    </View>
  );
});
EventPin.displayName = 'EventPin';

// ─── Cluster bubble ───────────────────────────────────────────────────────────
const ClusterBubble = memo(({ count, color }: { count: number; color: string }) => (
  <View style={[styles.clusterBubble, { borderColor: color + 'CC' }]}>
    <View style={[styles.clusterInner, { backgroundColor: color + '22' }]}>
      <Text style={[styles.clusterText, { color }]}>{count}</Text>
    </View>
  </View>
));
ClusterBubble.displayName = 'ClusterBubble';

// ─── Clustering logic ─────────────────────────────────────────────────────────
export function __test_clusterForRegion(
  list: EventWithGeo[],
  r: Region,
  getColor: (t?: string | null) => string,
  skipId?: string | null,
): ClusterItem[] {
  // Never cluster the selected event — it's always rendered individually
  const toCluster = skipId ? list.filter(e => e.id !== skipId) : list;

  const tryCluster = (mult: number) => {
    const latStep = Math.max(0.003, (r.latitudeDelta / 12) * mult);
    const lngStep = Math.max(0.003, (r.longitudeDelta / 12) * mult);
    const buckets = new Map<string, EventWithGeo[]>();
    for (const e of toCluster) {
      const key = `${Math.floor(e._lat / latStep)}:${Math.floor(e._lng / lngStep)}`;
      const arr = buckets.get(key);
      if (arr) arr.push(e); else buckets.set(key, [e]);
    }
    return buckets;
  };

  let mult = 1;
  let buckets = tryCluster(mult);
  const maxSlots = MAX_MARKERS_RENDERED - (skipId ? 1 : 0);
  while (buckets.size > maxSlots && mult < 16) {
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

  // Always inject the selected event as an individual marker
  if (skipId) {
    const selE = list.find(e => e.id === skipId);
    if (selE) {
      out.push({ kind: 'event', key: `e:${selE.id}`, center: { latitude: selE._lat, longitude: selE._lng }, event: selE, color: getColor(selE.eventType) });
    }
  }

  return out.sort((a, b) => (b.kind === 'cluster' ? b.count : 1) - (a.kind === 'cluster' ? a.count : 1));
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PartyMapScreen() {
  const { t } = useTranslation();
  const insets  = useSafeAreaInsets();
  const tabBarH = useBottomTabBarHeight();
  const params  = useLocalSearchParams<{ q?: string }>();

  const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL      || '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const mapsApiKey      = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const hasMapsKey      =
    Platform.OS !== 'android' ||
    (Constants as any)?.appOwnership === 'expo' ||
    (!!mapsApiKey && !mapsApiKey.includes('TU_CLAVE_API'));

  // ── Map state ────────────────────────────────────────────────────────────────
  const mapRef         = useRef<MapView>(null);
  const mapMountKeyRef = useRef(0);
  const [mapMountKey, setMapMountKey] = useState(0);
  const [mapReady,    setMapReady]    = useState(false);
  const [mapCrashed,  setMapCrashed]  = useState(false);
  const mapEverReadyRef  = useRef(false);
  const mapInitTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Zoom-based marker mode ───────────────────────────────────────────────────
  // false = small colored dot, true = price badge
  const [showPrice, setShowPrice] = useState(false);

  // ── Location ─────────────────────────────────────────────────────────────────
  const [locPerm, setLocPerm] = useState<'loading' | 'granted' | 'denied'>('loading');
  const DEFAULT_REGION: Region = { latitude: 40.4168, longitude: -3.7038, latitudeDelta: 0.12, longitudeDelta: 0.12 };
  const [initialRegion, setInitialRegion] = useState<Region>(DEFAULT_REGION);
  const viewportRef = useRef<Region>(DEFAULT_REGION);

  // ── Events cache ─────────────────────────────────────────────────────────────
  const allEventsRef       = useRef<Map<string, EventWithGeo & { _seenAt: number }>>(new Map());
  const fetchAbortRef      = useRef<AbortController | null>(null);
  const searchFetchAbortRef = useRef<AbortController | null>(null);
  const fetchSeqRef        = useRef(0);
  const lastBboxKeyRef     = useRef('');
  const lastFetchAtRef     = useRef(0);
  const debounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Clusters & selection ──────────────────────────────────────────────────────
  const [visibleClusters, setVisibleClusters] = useState<ClusterItem[]>([]);
  const lastSigRef   = useRef('');
  const [selectedEvent, setSelectedEvent] = useState<EventWithGeo | null>(null);
  const [selectedId,    setSelectedId]    = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);  // stable ref for callbacks

  // ── Search ───────────────────────────────────────────────────────────────────
  const [searchText,    setSearchText]    = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<EventWithGeo[]>([]);
  const [activeFilter,  setActiveFilter]  = useState('all');
  const [isSearching,   setIsSearching]   = useState(false);

  // ── Animations ───────────────────────────────────────────────────────────────
  const cardOpacity = useSharedValue(0);
  const cardY       = useSharedValue(24);
  const cardStyle   = useAnimatedStyle(() => ({
    opacity:   cardOpacity.value,
    transform: [{ translateY: cardY.value }],
  }));

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  const sanitizeRegion = useCallback((r: Region): Region => ({
    latitude:       clamp(Number.isFinite(Number(r?.latitude))       ? Number(r.latitude)       : 40.4168, -85, 85),
    longitude:      clamp(Number.isFinite(Number(r?.longitude))      ? Number(r.longitude)      : -3.7038, -180, 180),
    latitudeDelta:  clamp(Number.isFinite(Number(r?.latitudeDelta))  ? Number(r.latitudeDelta)  : 0.12, 0.002, 2.5),
    longitudeDelta: clamp(Number.isFinite(Number(r?.longitudeDelta)) ? Number(r.longitudeDelta) : 0.12, 0.002, 2.5),
  }), []);

  const haversineKm = useCallback((lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371, dL = ((lat2 - lat1) * Math.PI) / 180, dO = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dL / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dO / 2) ** 2;
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

  // Keep selectedIdRef in sync
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ─── Compute clusters ─────────────────────────────────────────────────────────
  const computeClusters = useCallback((region: Region, overrideSelId?: string | null) => {
    const selId = overrideSelId !== undefined ? overrideSelId : selectedIdRef.current;
    const all   = Array.from(allEventsRef.current.values());
    const pad   = 0.6;
    const minLat = region.latitude  - region.latitudeDelta  * (0.5 + pad);
    const maxLat = region.latitude  + region.latitudeDelta  * (0.5 + pad);
    const minLng = region.longitude - region.longitudeDelta * (0.5 + pad);
    const maxLng = region.longitude + region.longitudeDelta * (0.5 + pad);

    const visible = all.filter(e =>
      e._lat >= minLat && e._lat <= maxLat &&
      e._lng >= minLng && e._lng <= maxLng &&
      (activeFilter === 'all' || (e.eventType || 'party').toLowerCase().includes(activeFilter))
    );

    const clustered = __test_clusterForRegion(visible, region, getEventColor, selId);
    const sig = clustered.slice(0, 60).map(c => c.kind === 'cluster' ? `${c.key}:${c.count}` : c.key).join('|');
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;
    setVisibleClusters(clustered);
  }, [activeFilter]);

  // ─── Local search ─────────────────────────────────────────────────────────────
  const updateSearchResults = useCallback((text: string, filter: string) => {
    const q   = text.trim().toLowerCase();
    const all = Array.from(allEventsRef.current.values());
    if (!q && filter === 'all') { setSearchResults([]); return; }

    const filtered = all.filter(e => {
      const typeMatch = filter === 'all' || (e.eventType || 'party').toLowerCase().includes(filter);
      const textMatch = !q || [e.title, e.location, e.description, e.eventType]
        .some(f => (f || '').toLowerCase().includes(q));
      return typeMatch && textMatch;
    }).sort((a, b) => a._distanceKm - b._distanceKm).slice(0, 15);

    setSearchResults(filtered);
  }, []);

  // ─── API search by event title ────────────────────────────────────────────────
  const searchEventsByName = useCallback(async (q: string, filter: string) => {
    if (!q.trim() || !supabaseUrl || !supabaseAnonKey) return;
    if (searchFetchAbortRef.current) searchFetchAbortRef.current.abort();
    const ctrl = new AbortController();
    searchFetchAbortRef.current = ctrl;
    setIsSearching(true);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const sel = 'id,title,description,poster_url,event_date,ticket_price,event_type,venues!inner(name,latitude,longitude)';
      let url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/events?select=${encodeURIComponent(sel)}&title=ilike.*${encodeURIComponent(q.trim())}*&event_date=gte.${todayStart.toISOString()}&order=event_date.asc&limit=20`;
      if (filter !== 'all') url += `&event_type=ilike.*${encodeURIComponent(filter)}*`;

      const res = await withTimeout(fetch(url, {
        signal: ctrl.signal,
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      }), 8000);
      if (!res.ok) return;
      const remote = await res.json();
      if (!Array.isArray(remote)) return;

      const now  = Date.now();
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const vp   = viewportRef.current;
      for (const raw of remote) {
        const id = String(raw?.id || ''); if (!id) continue;
        const venue = raw?.venues || {};
        const lat = Number(venue.latitude), lng = Number(venue.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const d = new Date(raw.event_date);
        if (!allEventsRef.current.has(id)) {
          allEventsRef.current.set(id, {
            id, title: String(raw.title || ''),
            startsAt: raw.event_date, updatedAt: null,
            date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
            time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
            location: String(venue.name || 'Sin ubicación'),
            price: String(raw.ticket_price ?? '0'),
            capacity: 0, sold: 0,
            imageUrl: String(raw.poster_url || ''),
            description: String(raw.description || ''),
            eventType: String(raw.event_type || 'party').trim(),
            creatorId: raw.creator_id,
            ticketTypes: [],
            venues: { latitude: lat, longitude: lng, name: String(venue.name || '') },
            _lat: lat, _lng: lng,
            _distanceKm: haversineKm(vp.latitude, vp.longitude, lat, lng),
            _seenAt: now,
          } as any);
        }
      }
      updateSearchResults(q, filter);
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.warn('[PartyMap] name-search error:', e?.message);
    } finally {
      setIsSearching(false);
    }
  }, [supabaseUrl, supabaseAnonKey, withTimeout, haversineKm, updateSearchResults]);

  // Run local + debounced API search on text/filter change
  useEffect(() => {
    updateSearchResults(searchText, activeFilter);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchText.trim().length >= 2) {
      searchDebounceRef.current = setTimeout(() => {
        void searchEventsByName(searchText, activeFilter);
      }, 500);
    }
  }, [searchText, activeFilter, updateSearchResults, searchEventsByName]);

  // ─── Viewport fetch ───────────────────────────────────────────────────────────
  const fetchForRegion = useCallback(async (region: Region) => {
    if (!supabaseUrl || !supabaseAnonKey) return;
    const safe = sanitizeRegion(region);
    const pad  = 0.85;
    const minLat = safe.latitude  - safe.latitudeDelta  * (0.5 + pad);
    const maxLat = safe.latitude  + safe.latitudeDelta  * (0.5 + pad);
    const minLng = safe.longitude - safe.longitudeDelta * (0.5 + pad);
    const maxLng = safe.longitude + safe.longitudeDelta * (0.5 + pad);

    const bboxKey = `${minLat.toFixed(3)}|${maxLat.toFixed(3)}|${minLng.toFixed(3)}|${maxLng.toFixed(3)}`;
    if (bboxKey === lastBboxKeyRef.current && Date.now() - lastFetchAtRef.current < 8000) return;

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

      const res = await withTimeout(fetch(url, {
        signal: ctrl.signal,
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      }), 10000);
      if (seq !== fetchSeqRef.current) return;
      if (!res.ok) return;
      const remote = await res.json();
      if (!Array.isArray(remote)) return;

      const now  = Date.now();
      const pad2 = (n: number) => String(n).padStart(2, '0');
      for (const raw of remote) {
        const id = String(raw?.id || ''); if (!id) continue;
        const venue = raw?.venues || {};
        const lat = Number(venue.latitude), lng = Number(venue.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const d    = new Date(raw.event_date);
        const prev = allEventsRef.current.get(id);
        if (!prev || (raw.updated_at && prev.updatedAt !== raw.updated_at)) {
          allEventsRef.current.set(id, {
            id, title: String(raw.title || ''),
            startsAt: raw.event_date, updatedAt: raw.updated_at || null,
            date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
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
      if (e?.name !== 'AbortError') computeClusters(safe);
    }
  }, [supabaseUrl, supabaseAnonKey, sanitizeRegion, withTimeout, haversineKm, computeClusters, updateSearchResults, searchText, activeFilter]);

  // ─── Location permission ───────────────────────────────────────────────────────
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
        setMapCrashed(false);
        setMapMountKey(k => { mapMountKeyRef.current = k + 1; return k + 1; });
      }
    }, 14000);
    return () => { if (mapInitTimerRef.current) clearTimeout(mapInitTimerRef.current); };
  }, [locPerm, hasMapsKey, mapMountKey]);

  useEffect(() => {
    if (!mapReady) return;
    mapEverReadyRef.current = true;
    if (mapInitTimerRef.current) clearTimeout(mapInitTimerRef.current);
    computeClusters(viewportRef.current);
    void fetchForRegion(viewportRef.current);
  }, [mapReady, computeClusters, fetchForRegion]);

  // ─── Region change ────────────────────────────────────────────────────────────
  const onRegionChangeComplete = useCallback((r: Region) => {
    const next = sanitizeRegion(r);
    viewportRef.current = next;
    const newShowPrice = next.latitudeDelta < PRICE_ZOOM_THRESHOLD;
    setShowPrice(prev => prev !== newShowPrice ? newShowPrice : prev);
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
    // Update selectedId ref immediately — must happen BEFORE any re-render
    selectedIdRef.current = e.id;
    setSelectedId(e.id);
    setSelectedEvent(e);
    setSearchFocused(false);
    Keyboard.dismiss();

    const next = sanitizeRegion({
      latitude: e._lat,
      longitude: e._lng,
      latitudeDelta: EVENT_FOCUS_DELTA,
      longitudeDelta: EVENT_FOCUS_DELTA,
    });
    viewportRef.current = next;

    // Animate first — do NOT touch cluster state during the tap gesture.
    // On Android, any marker list re-render mid-press drops the touch event.
    // Cluster recompute (which ejects this event from its bucket) runs AFTER
    // the animation settles so the card appears without a double-tap.
    try { mapRef.current?.animateToRegion(next, 550); } catch {}
    setTimeout(() => computeClusters(next, e.id), 600);
  }, [sanitizeRegion, computeClusters]);

  // ─── Geocode search ───────────────────────────────────────────────────────────
  const geocodeSearch = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text) return;
    Keyboard.dismiss();
    setSearchFocused(false);
    try {
      const hits = await withTimeout(Location.geocodeAsync(text), 8000);
      if (!hits?.length) return;
      const next = sanitizeRegion({
        latitude: hits[0].latitude,
        longitude: hits[0].longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      });
      viewportRef.current = next;
      try { mapRef.current?.animateToRegion(next, 800); } catch {}
      computeClusters(next);
      void fetchForRegion(next);
    } catch {}
  }, [sanitizeRegion, computeClusters, fetchForRegion, withTimeout]);

  // ─── Deep-link q param ────────────────────────────────────────────────────────
  useEffect(() => {
    const q = String(params?.q || '').trim();
    if (!q) return;
    setSearchText(q);
    void geocodeSearch(q);
  }, [params?.q, geocodeSearch]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (debounceRef.current)        clearTimeout(debounceRef.current);
    if (searchDebounceRef.current)  clearTimeout(searchDebounceRef.current);
    if (fetchAbortRef.current)      fetchAbortRef.current.abort();
    if (searchFetchAbortRef.current) searchFetchAbortRef.current.abort();
  }, []);

  // ─── Recompute on filter change ───────────────────────────────────────────────
  useEffect(() => {
    computeClusters(viewportRef.current);
  }, [activeFilter, computeClusters]);

  // ─── Render ───────────────────────────────────────────────────────────────────
  const showResults = searchFocused && (searchText.trim().length > 0 || activeFilter !== 'all');

  const dismissSelected = useCallback(() => {
    selectedIdRef.current = null;
    setSelectedId(null);
    setSelectedEvent(null);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ── Map ── */}
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
            <TouchableOpacity
              onPress={() => { setMapCrashed(false); setMapReady(false); setMapMountKey(k => k + 1); }}
              style={styles.retryBtn}
            >
              <Text style={styles.retryTxt}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <MapErrorBoundary onError={() => { setMapCrashed(true); setMapReady(false); }}>
            <MapView
              key={`map:${mapMountKey}`}
              ref={mapRef}
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              style={StyleSheet.absoluteFillObject}
              initialRegion={initialRegion}
              onMapReady={() => setMapReady(true)}
              onMapLoaded={() => setMapReady(true)}
              onRegionChangeComplete={onRegionChangeComplete}
              showsUserLocation={locPerm === 'granted'}
              showsMyLocationButton={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              moveOnMarkerPress={false}
              showsCompass={false}
              loadingEnabled={false}
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
                        dismissSelected();
                        const base = viewportRef.current;
                        const next = sanitizeRegion({
                          latitude:       c.center.latitude,
                          longitude:      c.center.longitude,
                          latitudeDelta:  Math.max(EVENT_FOCUS_DELTA * 1.5, base.latitudeDelta * 0.45),
                          longitudeDelta: Math.max(EVENT_FOCUS_DELTA * 1.5, base.longitudeDelta * 0.45),
                        });
                        try { mapRef.current?.animateToRegion(next, 480); } catch {}
                      }}
                    >
                      <ClusterBubble count={c.count} color={c.color} />
                    </Marker>
                  );
                }

                const e     = c.event;
                const isSel = selectedId === e.id;
                return (
                  <Marker
                    key={c.key}
                    identifier={`event:${e.id}`}
                    coordinate={c.center}
                    tracksViewChanges={false}
                    onPress={() => focusOnEvent(e)}
                  >
                    {(showPrice || isSel) ? (
                      <EventPin color={c.color} selected={isSel} price={e.price} />
                    ) : (
                      <EventDot color={c.color} selected={isSel} />
                    )}
                  </Marker>
                );
              })}
            </MapView>
          </MapErrorBoundary>
        )}
      </View>

      {/* ── Top overlay: search + filters ── */}
      <View style={[styles.topOverlay, { paddingTop: Math.max(12, insets.top) }]}>
        {/* Search bar */}
        <GlassView intensity={20} style={styles.searchBar}>
          <View style={styles.searchRow}>
            {isSearching ? (
              <View style={styles.searchIconWrap}>
                <DiscoLoader size={16} />
              </View>
            ) : (
              <Search size={18} color="rgba(255,255,255,0.5)" />
            )}
            <TextInput
              value={searchText}
              onChangeText={text => { setSearchText(text); setSearchFocused(true); }}
              onFocus={() => setSearchFocused(true)}
              placeholder="Busca fiestas, ciudad, barrio, calle…"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              onSubmitEditing={() => {
                const q = searchText.trim();
                if (searchResults.length > 0) {
                  focusOnEvent(searchResults[0]);
                } else {
                  void geocodeSearch(q);
                }
              }}
              style={styles.searchInput}
            />
            {searchText.length > 0 && (
              <Pressable hitSlop={10} onPress={() => {
                setSearchText('');
                setSearchFocused(false);
                setSearchResults([]);
              }}>
                <X size={18} color="rgba(255,255,255,0.5)" />
              </Pressable>
            )}
          </View>
        </GlassView>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 8 }}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
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
        </ScrollView>

        {/* Search results */}
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
                  <TouchableOpacity activeOpacity={0.75} style={styles.resultRow} onPress={() => focusOnEvent(item)}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.resultImg} />
                    ) : (
                      <View style={[styles.resultImg, { backgroundColor: color + '30', alignItems: 'center', justifyContent: 'center' }]}>
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
            {/* Always offer geocode option when text present */}
            {searchText.trim().length > 1 && (
              <TouchableOpacity style={styles.geocodeRow} onPress={() => void geocodeSearch(searchText)}>
                <MapPin size={13} color={Colors.dark.primary} />
                <Text style={styles.geocodeTxt}>Buscar "{searchText}" en el mapa</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {showResults && searchResults.length === 0 && searchText.trim().length > 1 && (
          <Animated.View entering={FadeIn.duration(180)} style={styles.noResults}>
            <Text style={styles.noResultsTxt}>Sin resultados para "{searchText}"</Text>
            <TouchableOpacity onPress={() => void geocodeSearch(searchText)}>
              <Text style={styles.noResultsSearch}>Buscar ubicación en el mapa →</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>

      {/* ── Dismiss overlay ── */}
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
          <View style={styles.card}>
            <Pressable onPress={dismissSelected} style={styles.cardDismiss} />
            {selectedEvent.imageUrl ? (
              <Image source={{ uri: selectedEvent.imageUrl }} style={styles.cardBanner} resizeMode="cover" />
            ) : (
              <LinearGradient colors={[getEventColor(selectedEvent.eventType) + '40', '#08080F']} style={styles.cardBanner} />
            )}
            <LinearGradient
              colors={['transparent', 'rgba(8,8,15,0.85)', 'rgba(8,8,15,0.98)']}
              locations={[0, 0.55, 1]}
              style={styles.cardBannerOverlay}
            />
            <Pressable onPress={dismissSelected} style={styles.cardCloseBtn}>
              <X size={14} color="white" />
            </Pressable>
            <View style={[styles.cardPriceBadge, { backgroundColor: getEventColor(selectedEvent.eventType) }]}>
              <Text style={styles.cardPriceBadgeTxt}>{formatPrice(selectedEvent.price)}</Text>
            </View>
            <View style={styles.cardBody}>
              <View style={styles.cardTopRow}>
                <View style={[styles.typeBadge, { backgroundColor: getEventColor(selectedEvent.eventType) + '30' }]}>
                  <Text style={[styles.typeBadgeTxt, { color: getEventColor(selectedEvent.eventType) }]}>
                    {(selectedEvent.eventType || 'Evento').toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.cardDist, { color: getEventColor(selectedEvent.eventType) }]}>
                  {selectedEvent._distanceKm.toFixed(1)} km
                </Text>
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>{selectedEvent.title}</Text>
              <View style={styles.cardMetaRow}>
                <MapPin size={11} color="rgba(255,255,255,0.45)" />
                <Text style={styles.cardMeta} numberOfLines={1}>{selectedEvent.location}</Text>
              </View>
              <View style={styles.cardMetaRow}>
                <Calendar size={11} color="rgba(255,255,255,0.45)" />
                <Text style={styles.cardMeta}>{selectedEvent.date} · {selectedEvent.time}</Text>
              </View>
              <Pressable
                onPress={() => router.push(`/(tabs)/event/${selectedEvent.id}`)}
                style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
              >
                <LinearGradient
                  colors={[Colors.dark.primary, Colors.dark.secondary]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.btnDetail}
                >
                  <Text style={styles.btnDetailTxt}>Ver evento →</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#08080F' },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  loadingTxt: { color: 'rgba(255,255,255,0.5)', fontWeight: '700', marginTop: 8 },
  errTitle:   { color: 'white', fontWeight: '900', fontSize: 18, textAlign: 'center' },
  retryBtn:   { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, backgroundColor: Colors.dark.primary + '30', borderWidth: 1, borderColor: Colors.dark.primary + '60' },
  retryTxt:   { color: Colors.dark.primary, fontWeight: '900', fontSize: 14 },

  topOverlay:     { position: 'absolute', left: 14, right: 14, zIndex: 40 },
  searchBar:      { borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(8,8,15,0.88)', overflow: 'hidden' },
  searchRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  searchIconWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  searchInput:    { flex: 1, color: 'white', fontWeight: '700', fontSize: 15, paddingVertical: 0, letterSpacing: -0.2 },

  filterRow:     { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  filterChip:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  filterChipTxt: { color: 'rgba(255,255,255,0.5)', fontWeight: '800', fontSize: 11 },

  resultsPanel:    { marginTop: 8, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(10,10,20,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', maxHeight: 360 },
  resultSep:       { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 14 },
  resultRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  resultImg:       { width: 50, height: 50, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  resultImgDot:    { width: 16, height: 16, borderRadius: 8 },
  resultInfo:      { flex: 1, gap: 4 },
  resultTitle:     { color: 'white', fontWeight: '800', fontSize: 14 },
  resultMeta:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resultMetaTxt:   { color: 'rgba(255,255,255,0.45)', fontSize: 12, flex: 1 },
  resultDist:      { fontSize: 12, fontWeight: '800' },
  resultPriceBadge:{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  resultPrice:     { fontWeight: '900', fontSize: 12 },

  geocodeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  geocodeTxt: { color: Colors.dark.primary, fontWeight: '700', fontSize: 13 },

  noResults:      { marginTop: 8, borderRadius: 16, padding: 16, backgroundColor: 'rgba(10,10,20,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', gap: 6 },
  noResultsTxt:   { color: 'rgba(255,255,255,0.5)', fontWeight: '700', fontSize: 13 },
  noResultsSearch:{ color: Colors.dark.primary, fontWeight: '900', fontSize: 13 },

  // Dot marker (low zoom)
  dotOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
  dotInner: { width: 11, height: 11, borderRadius: 6 },

  // Price-badge marker (high zoom)
  pinWrap:         { alignItems: 'center', justifyContent: 'center' },
  pinWrapSelected: { transform: [{ scale: 1.18 }] },
  pinPulse:        { position: 'absolute', width: 52, height: 52, borderRadius: 26, borderWidth: 2 },
  pinBadge:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.7, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 6, minWidth: 46 },
  pinPrice:        { fontSize: 12, fontWeight: '900', letterSpacing: -0.3 },
  pinTailOuter:    { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -1 },

  clusterBubble: { borderWidth: 2, borderRadius: 999, overflow: 'hidden' },
  clusterInner:  { paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  clusterText:   { fontSize: 13, fontWeight: '900', letterSpacing: -0.3 },

  // Event card
  cardWrap:          { position: 'absolute', left: 12, right: 12, bottom: 0, zIndex: 30 },
  card:              { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: '#0c0c1a' },
  cardDismiss:       { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  cardBanner:        { width: '100%', height: 130 },
  cardBannerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 130 },
  cardCloseBtn:      { position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  cardPriceBadge:    { position: 'absolute', top: 10, left: 12, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  cardPriceBadgeTxt: { color: 'white', fontWeight: '900', fontSize: 12 },
  cardBody:          { padding: 12, gap: 5 },
  cardTopRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeBadge:         { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeBadgeTxt:      { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  cardTitle:         { color: 'white', fontWeight: '900', fontSize: 15, letterSpacing: -0.3 },
  cardMetaRow:       { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMeta:          { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', flex: 1 },
  cardDist:          { fontSize: 12, fontWeight: '900' },
  btnDetail:         { height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 4 },
  btnDetailTxt:      { color: 'white', fontWeight: '900', fontSize: 13, letterSpacing: -0.2 },
});
