import { useCallback, useEffect, useRef, useState } from 'react';
import { useFilters } from '@/lib/FilterContext';
import {
  View, Text, StyleSheet, Pressable, StatusBar,
  Image, TextInput, Keyboard, FlatList, TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import type { AppEvent } from '@/lib/EventContext';
import { router, useLocalSearchParams } from 'expo-router';
import { Search, X, MapPin, Calendar, Flame, Music, Sparkles, Tag } from '@/lib/icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import WebView from 'react-native-webview';

// ─── Types ────────────────────────────────────────────────────────────────────
type EventWithGeo = AppEvent & { _lat: number; _lng: number; _distanceKm: number };

// ─── Constants ────────────────────────────────────────────────────────────────
const FETCH_HORIZON_DAYS    = 90;
const MAX_EVENTS_CACHE      = 2000;
const MAX_EVENT_CACHE_AGE_MS = 1000 * 60 * 30;
const VIEWPORT_DEBOUNCE_MS  = 600;

// ─── Leaflet HTML ─────────────────────────────────────────────────────────────
// ── Replace YOUR_MAPTILER_KEY with your free key from cloud.maptiler.com ──
const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY || '';

const buildMapHtml = (lat: number, lng: number) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
<script src="https://unpkg.com/supercluster@8.0.1/dist/supercluster.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:#0d1117;overflow:hidden;-webkit-tap-highlight-color:transparent}
#map{width:100%;height:100%}
.maplibregl-ctrl-attrib,.maplibregl-ctrl-logo,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-bottom-left{display:none!important}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
var RN=window.ReactNativeWebView;
function post(o){try{RN.postMessage(JSON.stringify(o));}catch(e){}}
window.addEventListener('error',function(){post({type:'mapError'});});

function eventColor(type){
  if(!type)return'#A78BFA';
  var t=type.toLowerCase();
  if(t.includes('concert')||t.includes('concierto'))return'#38BDF8';
  if(t.includes('festival'))return'#FB923C';
  if(t.includes('party')||t.includes('fiesta'))return'#A78BFA';
  if(t.includes('techno'))return'#EC4899';
  return'#34D399';
}

var selectedId=null;
var eventsData={type:'FeatureCollection',features:[]};

var PRICE_ZOOM=14;
var selectedId=null;
var allFeatures=[];
var domMarkers={};   // id|cluster_id -> {marker, type}

/* ─── supercluster ─── */
var sc=new Supercluster({radius:55,maxZoom:PRICE_ZOOM-1,minPoints:2});

var map=new maplibregl.Map({
  container:'map',
  style:'https://api.maptiler.com/maps/streets-v4/style.json?key=${encodeURIComponent(MAPTILER_KEY)}',
  center:[${lng},${lat}],
  zoom:13,
  attributionControl:false,
  fadeDuration:200,
});

map.on('error',function(){if(!map.isStyleLoaded())post({type:'mapError'});});
map.on('load',function(){
  scheduleRefresh();
  map.on('moveend',scheduleRefresh);
  map.on('zoomend',scheduleRefresh);
  map.on('click',function(e){
    if(e.defaultPrevented)return;
    selectedId=null;
    renderMarkers();
    post({type:'mapClick'});
  });
  post({type:'ready'});
});

var rafTimer=null;
function scheduleRefresh(){
  clearTimeout(rafTimer);
  rafTimer=setTimeout(function(){
    renderMarkers();
    var c=map.getCenter();var b=map.getBounds();
    post({type:'regionChange',lat:c.lat,lng:c.lng,zoom:map.getZoom(),
      minLat:b.getSouth(),maxLat:b.getNorth(),minLng:b.getWest(),maxLng:b.getEast()});
  },180);
}

/* ─── render all markers ─── */
function renderMarkers(){
  if(!allFeatures.length)return;
  var zoom=Math.round(map.getZoom());
  var b=map.getBounds();
  var bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
  var clusters=sc.getClusters(bbox,zoom);

  /* ids in this frame */
  var frameIds=new Set(clusters.map(function(f){
    return f.properties.cluster?'c'+f.properties.cluster_id:'e'+f.properties.id;
  }));

  /* remove stale */
  Object.keys(domMarkers).forEach(function(k){
    if(!frameIds.has(k)){domMarkers[k].remove();delete domMarkers[k];}
  });

  clusters.forEach(function(f){
    if(f.properties.cluster){
      renderCluster(f);
    }else{
      renderEvent(f,zoom);
    }
  });
}

/* ─── cluster bubble ─── */
function renderCluster(f){
  var cid='c'+f.properties.cluster_id;
  if(domMarkers[cid])return;
  var count=f.properties.point_count;
  var s=count<10?38:count<50?46:54;
  var el=document.createElement('div');
  el.style.cssText='width:'+s+'px;height:'+s+'px;border-radius:50%;'
    +'background:linear-gradient(135deg,#7C3AED,#A78BFA);'
    +'display:flex;align-items:center;justify-content:center;'
    +'color:#fff;font-size:'+(count<10?13:11)+'px;font-weight:800;'
    +'font-family:-apple-system,BlinkMacSystemFont,sans-serif;'
    +'box-shadow:0 0 0 3px rgba(167,139,250,0.25),0 4px 16px rgba(124,58,237,0.55);'
    +'cursor:pointer;user-select:none;';
  el.textContent=count<1000?count:'1k+';
  el.addEventListener('click',function(e){
    e.stopPropagation();
    var exp=sc.getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({center:f.geometry.coordinates,zoom:exp,duration:350});
  });
  domMarkers[cid]=new maplibregl.Marker({element:el,anchor:'center'})
    .setLngLat(f.geometry.coordinates).addTo(map);
}

/* ─── single event dot / price pill ─── */
function renderEvent(f,zoom){
  var eid='e'+f.properties.id;
  var isSel=f.properties.id===selectedId;
  var color=f.properties.color;
  var price=f.properties.price;
  var showPrice=zoom>=PRICE_ZOOM;

  /* build element */
  var el=document.createElement('div');
  if(showPrice){
    /* price pill */
    var label=(!price||price<=0)?'Free':Math.round(price)+'€';
    el.style.cssText=[
      'padding:5px 11px',
      'border-radius:22px',
      'font-size:12px','font-weight:700',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'white-space:nowrap','cursor:pointer',
      'transition:transform 0.15s ease,box-shadow 0.15s ease',
      'user-select:none',
      isSel
        ?'background:'+color+';color:#fff;border:none;'
         +'box-shadow:0 0 0 2px #fff,0 4px 16px '+color+'99;'
         +'transform:scale(1.1);'
        :'background:rgba(10,10,20,0.82);color:'+color+';'
         +'border:1.5px solid '+color+';'
         +'box-shadow:0 2px 12px rgba(0,0,0,0.6);',
    ].join(';');
    el.textContent=label;
  }else{
    /* dot */
    var r=isSel?13:8;
    el.style.cssText='width:'+r*2+'px;height:'+r*2+'px;border-radius:50%;'
      +'background:'+color+';cursor:pointer;'
      +'border:'+(isSel?'2.5px solid #fff':'2px solid rgba(255,255,255,0.5)')+';'
      +'box-shadow:0 0 '+(isSel?'14':'8')+'px '+color+(isSel?'cc':'88')+';'
      +'transition:all 0.15s ease;';
  }

  el.addEventListener('click',function(e){
    e.stopPropagation();
    e.preventDefault();
    selectedId=f.properties.id;
    renderMarkers();
    post({type:'eventClick',id:f.properties.id});
  });

  /* remove stale marker and recreate */
  if(domMarkers[eid])domMarkers[eid].remove();
  domMarkers[eid]=new maplibregl.Marker({element:el,anchor:'center'})
    .setLngLat(f.geometry.coordinates).addTo(map);
}

/* ─── public API ─── */
window.setEvents=function(json){
  try{
    var events=JSON.parse(json);
    allFeatures=events.map(function(e){
      return{type:'Feature',
        geometry:{type:'Point',coordinates:[e.lng,e.lat]},
        properties:{id:e.id,color:eventColor(e.eventType),price:e.price,title:e.title}};
    });
    sc.load(allFeatures);
    renderMarkers();
  }catch(err){post({type:'error',msg:String(err)});}
};
window.deselectAll=function(){selectedId=null;renderMarkers();};
window.flyTo=function(lat,lng){
  map.flyTo({center:[lng,lat],zoom:Math.max(map.getZoom(),14),duration:700,essential:true});
};
window.setCenter=function(lat,lng,zoom){
  map.jumpTo({center:[lng,lat],zoom:zoom||map.getZoom()});
};
</script>
</body>
</html>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getEventColor(eventType?: string | null): string {
  const t = String(eventType || '').toLowerCase();
  if (t.includes('concert')  || t.includes('concierto')) return '#38BDF8';
  if (t.includes('festival'))                             return '#FB923C';
  if (t.includes('party')    || t.includes('fiesta'))    return '#A78BFA';
  if (t.includes('techno'))                              return '#EC4899';
  return '#34D399';
}

const EVENT_TYPES = [
  { key: 'all',      label: 'Todo',      color: '#FFFFFF', Icon: Sparkles },
  { key: 'party',    label: 'Fiesta',    color: '#A78BFA', Icon: Flame    },
  { key: 'concert',  label: 'Concierto', color: '#38BDF8', Icon: Music    },
  { key: 'festival', label: 'Festival',  color: '#FB923C', Icon: Sparkles },
  { key: 'other',    label: 'Otro',      color: '#34D399', Icon: Tag      },
];

// ─── Main component ───────────────────────────────────────────────────────────
export default function PartyMapScreen() {
  const insets  = useSafeAreaInsets();
  const tabBarH = useBottomTabBarHeight();
  const params  = useLocalSearchParams<{ q?: string }>();

  const supabaseUrl     = process.env.EXPO_PUBLIC_SUPABASE_URL      || '';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const webViewRef       = useRef<WebView>(null);
  const mapReadyRef      = useRef(false);
  const pendingEventsRef = useRef<string | null>(null);
  const fetchAbortRef    = useRef<AbortController | null>(null);
  const searchAbortRef   = useRef<AbortController | null>(null);
  const debounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeqRef      = useRef(0);
  const lastBboxRef      = useRef('');
  const lastFetchAtRef   = useRef(0);
  const allEventsRef     = useRef<Map<string, EventWithGeo & { _seenAt: number }>>(new Map());
  const currentRegionRef = useRef({ lat: 40.4168, lng: -3.7038, zoom: 13 });

  // ── State ─────────────────────────────────────────────────────────────────────
  const [, setMapReady] = useState(false);
  const [, setLocPerm] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [, setInitialCenter] = useState({ lat: 40.4168, lng: -3.7038 });
  const [selectedEvent, setSelectedEvent] = useState<EventWithGeo | null>(null);
  const [searchText,    setSearchText]    = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<EventWithGeo[]>([]);
  const [activeFilter,  setActiveFilter]  = useState('all');
  const activeFilterRef = useRef('all');
  const [isSearching,   setIsSearching]   = useState(false);
  const [htmlContent,   setHtmlContent]   = useState<string | null>(null);
  const [mapError, setMapError] = useState(!MAPTILER_KEY.trim());

  // ── Shared filters (from feed) ────────────────────────────────────────────────
  const { filters: sharedFilters } = useFilters();
  const sharedFiltersRef = useRef(sharedFilters);
  useEffect(() => { sharedFiltersRef.current = sharedFilters; }, [sharedFilters]);

  // ── Helpers ───────────────────────────────────────────────────────────────────
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
    return Promise.race([p, new Promise<never>((_, rej) => { id = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(id));
  }, []);

  // ── Send events to WebView (applies shared filters before sending) ────────────
  const sendEventsToMap = useCallback(() => {
    const f = sharedFiltersRef.current;
    const mapFilter = activeFilterRef.current; // the map's own event-type chips
    let events = [...allEventsRef.current.values()];

    // Map's own event-type chip filter
    if (mapFilter && mapFilter !== 'all') {
      events = events.filter(e =>
        String(e.eventType || '').toLowerCase().includes(mapFilter) ||
        String(e.theme || '').toLowerCase().includes(mapFilter) ||
        String(e.title || '').toLowerCase().includes(mapFilter)
      );
    }

    if (f.musicType) {
      const m = f.musicType.toLowerCase();
      events = events.filter(e =>
        e.theme?.toLowerCase().includes(m) ||
        e.eventType?.toLowerCase().includes(m) ||
        e.description?.toLowerCase().includes(m) ||
        e.title?.toLowerCase().includes(m)
      );
    }
    if (f.maxPrice != null) {
      events = events.filter(e => parseFloat(String(e.price ?? '0')) <= f.maxPrice!);
    }
    if (f.minAge) {
      events = events.filter(e => {
        if (!e.ageRestriction) return false;
        const age = parseInt(String(e.ageRestriction).replace(/\D/g, '')) || 0;
        return age >= f.minAge!;
      });
    }
    if (f.dressCode) {
      const dc = f.dressCode.toLowerCase();
      events = events.filter(e => e.dressCode?.toLowerCase().includes(dc));
    }

    const payload = events.map(e => ({
      id:        e.id,
      lat:       e._lat,
      lng:       e._lng,
      eventType: e.eventType,
      title:     e.title,
      price:     e.price,
    }));
    const json = JSON.stringify(payload);
    if (!mapReadyRef.current) {
      pendingEventsRef.current = json;
      return;
    }
    webViewRef.current?.injectJavaScript(`window.setEvents(${JSON.stringify(json)});true;`);
  }, []);

  // Keep ref in sync after the callback has been initialized.
  useEffect(() => {
    activeFilterRef.current = activeFilter;
    if (mapReadyRef.current) sendEventsToMap();
  }, [activeFilter, sendEventsToMap]);

  // ── Fetch events for viewport ─────────────────────────────────────────────────
  const fetchForRegion = useCallback(async (minLat: number, maxLat: number, minLng: number, maxLng: number) => {
    if (!supabaseUrl || !supabaseAnonKey) return;

    const pad    = 0.5;
    const pMinLat = minLat - (maxLat - minLat) * pad;
    const pMaxLat = maxLat + (maxLat - minLat) * pad;
    const pMinLng = minLng - (maxLng - minLng) * pad;
    const pMaxLng = maxLng + (maxLng - minLng) * pad;

    const bboxKey = `${pMinLat.toFixed(3)}|${pMaxLat.toFixed(3)}|${pMinLng.toFixed(3)}|${pMaxLng.toFixed(3)}`;
    if (bboxKey === lastBboxRef.current && Date.now() - lastFetchAtRef.current < 8000) return;

    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;
    const seq = ++fetchSeqRef.current;
    lastBboxRef.current = bboxKey;

    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const fromIso = todayStart.toISOString();
      const toIso   = new Date(todayStart.getTime() + 86400000 * FETCH_HORIZON_DAYS).toISOString();
      const sel = 'id,title,description,poster_url,event_date,ticket_price,available_tickets,sold_tickets,event_type,creator_id,updated_at,venues!inner(name,latitude,longitude)';
      const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/events`
        + `?select=${encodeURIComponent(sel)}&order=event_date.asc`
        + `&event_date=gte.${encodeURIComponent(fromIso)}&event_date=lte.${encodeURIComponent(toIso)}`
        + `&venues.latitude=gte.${pMinLat}&venues.latitude=lte.${pMaxLat}`
        + `&venues.longitude=gte.${pMinLng}&venues.longitude=lte.${pMaxLng}`;

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
      const center = currentRegionRef.current;

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
            _distanceKm: haversineKm(center.lat, center.lng, lat, lng),
            _seenAt: now,
          } as any);
        } else { (prev as any)._seenAt = now; }
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
      sendEventsToMap();
    } catch (e: any) {
      if (e?.name !== 'AbortError') sendEventsToMap();
    }
  }, [supabaseUrl, supabaseAnonKey, withTimeout, haversineKm, sendEventsToMap]);

  // ── Re-send pins whenever shared filters change ───────────────────────────────
  useEffect(() => {
    if (mapReadyRef.current) sendEventsToMap();
  }, [sharedFilters, sendEventsToMap]);

  // ── WebView message handler ───────────────────────────────────────────────────
  const onWebViewMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        setMapError(false);
        mapReadyRef.current = true;
        setMapReady(true);
        if (pendingEventsRef.current) {
          webViewRef.current?.injectJavaScript(`window.setEvents(${JSON.stringify(pendingEventsRef.current)});true;`);
          pendingEventsRef.current = null;
        } else {
          sendEventsToMap();
        }
      } else if (msg.type === 'mapError') {
        setMapError(true);
      } else if (msg.type === 'regionChange') {
        currentRegionRef.current = { lat: msg.lat, lng: msg.lng, zoom: msg.zoom };
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchForRegion(msg.minLat, msg.maxLat, msg.minLng, msg.maxLng);
        }, VIEWPORT_DEBOUNCE_MS);
      } else if (msg.type === 'eventClick') {
        const ev = allEventsRef.current.get(msg.id);
        if (ev) setSelectedEvent(ev);
        setSearchFocused(false);
        Keyboard.dismiss();
      } else if (msg.type === 'mapClick') {
        setSelectedEvent(null);
      }
    } catch {}
  }, [fetchForRegion, sendEventsToMap]);

  // ── Location permission ───────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const perm = await withTimeout(Location.requestForegroundPermissionsAsync(), 6000);
        if (!mounted) return;
        if (perm.status !== 'granted') { setLocPerm('denied'); setHtmlContent(buildMapHtml(40.4168, -3.7038)); return; }
        setLocPerm('granted');
        const pos = await withTimeout(Location.getCurrentPositionAsync({}), 8000);
        if (!mounted) return;
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        setInitialCenter({ lat, lng });
        currentRegionRef.current = { lat, lng, zoom: 13 };
        setHtmlContent(buildMapHtml(lat, lng));
      } catch {
        if (mounted) { setLocPerm('denied'); setHtmlContent(buildMapHtml(40.4168, -3.7038)); }
      }
    })();
    return () => { mounted = false; };
  }, [withTimeout]);

  // ── Deep-link q param ─────────────────────────────────────────────────────────
  useEffect(() => {
    const q = String(params?.q || '').trim();
    if (!q || !mapReadyRef.current) return;
    setSearchText(q);
    (async () => {
      try {
        const hits = await withTimeout(Location.geocodeAsync(q), 8000);
        if (!hits?.length) return;
        webViewRef.current?.injectJavaScript(`window.flyTo(${hits[0].latitude},${hits[0].longitude});true;`);
      } catch {}
    })();
  }, [params?.q, withTimeout]);

  // ── Search ────────────────────────────────────────────────────────────────────
  const updateLocalResults = useCallback((q: string, filter: string) => {
    const query = q.trim().toLowerCase();
    const f = sharedFiltersRef.current;
    const hasSharedFilter = f.musicType || f.maxPrice != null || f.minAge || f.dressCode;
    if (!query && filter === 'all' && !hasSharedFilter) { setSearchResults([]); return; }
    const results = [...allEventsRef.current.values()]
      .filter(e => {
        if (filter !== 'all' && !String(e.eventType || '').toLowerCase().includes(filter)) return false;
        if (query && ![e.title, e.location, e.description].some(s => String(s || '').toLowerCase().includes(query))) return false;
        if (f.musicType) {
          const m = f.musicType.toLowerCase();
          if (!(e.theme?.toLowerCase().includes(m) || e.eventType?.toLowerCase().includes(m) || e.description?.toLowerCase().includes(m) || e.title?.toLowerCase().includes(m))) return false;
        }
        if (f.maxPrice != null && parseFloat(String(e.price ?? '0')) > f.maxPrice) return false;
        if (f.minAge) {
          const age = parseInt(String(e.ageRestriction ?? '').replace(/\D/g, '')) || 0;
          if (age < f.minAge) return false;
        }
        if (f.dressCode && !e.dressCode?.toLowerCase().includes(f.dressCode.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a._distanceKm - b._distanceKm)
      .slice(0, 20);
    setSearchResults(results);
  }, []);

  const searchByName = useCallback(async (q: string, filter: string) => {
    if (!q.trim() || !supabaseUrl) return;
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setIsSearching(true);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const sel = 'id,title,poster_url,event_date,ticket_price,event_type,creator_id,updated_at,venues!inner(name,latitude,longitude)';
      const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/events`
        + `?select=${encodeURIComponent(sel)}&title=ilike.${encodeURIComponent(`*${q}*`)}`
        + `&event_date=gte.${encodeURIComponent(todayStart.toISOString())}&limit=20`;
      const res = await withTimeout(fetch(url, { signal: ctrl.signal, headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` } }), 8000);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const center = currentRegionRef.current;
      const now = Date.now();
      const pad2 = (n: number) => String(n).padStart(2, '0');
      for (const raw of data) {
        const id = String(raw?.id || ''); if (!id) continue;
        const venue = raw?.venues || {};
        const lat = Number(venue.latitude), lng = Number(venue.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (!allEventsRef.current.has(id)) {
          const d = new Date(raw.event_date);
          allEventsRef.current.set(id, {
            id, title: String(raw.title || ''), startsAt: raw.event_date,
            updatedAt: raw.updated_at || null,
            date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
            time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
            location: String(venue.name || ''), price: String(raw.ticket_price ?? '0'),
            capacity: 0, sold: 0, imageUrl: String(raw.poster_url || ''),
            description: '', eventType: String(raw.event_type || 'party').trim(),
            creatorId: raw.creator_id, ticketTypes: [],
            venues: { latitude: lat, longitude: lng, name: String(venue.name || '') },
            _lat: lat, _lng: lng,
            _distanceKm: haversineKm(center.lat, center.lng, lat, lng),
            _seenAt: now,
          } as any);
        }
      }
      updateLocalResults(q, filter);
    } catch (e: any) {
      if (e?.name !== 'AbortError') updateLocalResults(q, filter);
    } finally { setIsSearching(false); }
  }, [supabaseUrl, supabaseAnonKey, withTimeout, haversineKm, updateLocalResults]);

  useEffect(() => {
    updateLocalResults(searchText, activeFilter);
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    if (searchText.trim().length >= 2) {
      searchDebRef.current = setTimeout(() => searchByName(searchText, activeFilter), 500);
    }
  }, [searchText, activeFilter, updateLocalResults, searchByName]);

  const focusOnEvent = useCallback((e: EventWithGeo) => {
    setSelectedEvent(e);
    setSearchFocused(false);
    Keyboard.dismiss();
    webViewRef.current?.injectJavaScript(`window.flyTo(${e._lat},${e._lng});true;`);
  }, []);

  const dismissSelected = useCallback(() => {
    setSelectedEvent(null);
    webViewRef.current?.injectJavaScript(`window.deselectAll();true;`);
  }, []);

  const geocodeSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    Keyboard.dismiss();
    setSearchFocused(false);
    try {
      const hits = await withTimeout(Location.geocodeAsync(q), 8000);
      if (!hits?.length) return;
      webViewRef.current?.injectJavaScript(`window.flyTo(${hits[0].latitude},${hits[0].longitude});true;`);
    } catch {}
  }, [withTimeout]);

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (debounceRef.current)  clearTimeout(debounceRef.current);
    if (searchDebRef.current) clearTimeout(searchDebRef.current);
    if (fetchAbortRef.current)  fetchAbortRef.current.abort();
    if (searchAbortRef.current) searchAbortRef.current.abort();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────────
  const showResults = searchFocused && (searchText.trim().length > 0 || activeFilter !== 'all');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ── Map (WebView) ── */}
      {htmlContent ? (
        <WebView
          ref={webViewRef}
          source={{ html: htmlContent, baseUrl: 'https://api.maptiler.com' }}
          style={StyleSheet.absoluteFill}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          allowUniversalAccessFromFileURLs
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          onMessage={onWebViewMessage}
          originWhitelist={['*']}
          mixedContentMode="always"
          androidLayerType="hardware"
          onError={() => setMapError(true)}
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <DiscoLoader size={60} />
              <Text style={styles.loadingTxt}>Cargando mapa…</Text>
            </View>
          )}
          startInLoadingState
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <DiscoLoader size={60} />
          <Text style={styles.loadingTxt}>Obteniendo ubicación…</Text>
        </View>
      )}

      {mapError && (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: '#08080F', zIndex: 50 }]}>
          <MapPin size={32} color={Colors.dark.primary} />
          <Text style={{ color: 'white', fontWeight: '700', textAlign: 'center' }}>No se ha podido cargar el mapa.</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', textAlign: 'center' }}>Puedes seguir consultando los eventos en la lista.</Text>
          <Pressable accessibilityRole="button" onPress={() => {
            setMapError(!MAPTILER_KEY.trim());
            mapReadyRef.current = false;
            webViewRef.current?.reload();
          }}><Text style={{ color: Colors.dark.primary, padding: 12 }}>Reintentar</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)')}>
            <Text style={{ color: 'white', padding: 12 }}>Ver eventos</Text>
          </Pressable>
        </View>
      )}

      {/* ── Top overlay: search + filters ── */}
      <View style={[styles.topOverlay, { paddingTop: Math.max(12, insets.top) }]}>
        <GlassView intensity={20} style={styles.searchBar}>
          <View style={styles.searchRow}>
            {isSearching ? (
              <View style={styles.searchIconWrap}><DiscoLoader size={16} /></View>
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
                if (searchResults.length > 0) focusOnEvent(searchResults[0]);
                else void geocodeSearch(searchText);
              }}
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={styles.filterRow}>
          {EVENT_TYPES.map(({ key, label, color, Icon }) => {
            const active = activeFilter === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setActiveFilter(key)}
                style={[styles.filterChip, active && { backgroundColor: 'rgba(8,8,18,0.92)', borderColor: color }]}
              >
                <Icon size={13} color={active ? color : 'rgba(255,255,255,0.4)'} />
                <Text style={[styles.filterChipTxt, active && { color }]}>{label}</Text>
              </TouchableOpacity>
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
              ItemSeparatorComponent={() => <View style={styles.resultSep} />}
              renderItem={({ item }) => {
                const color = getEventColor(item.eventType);
                return (
                  <TouchableOpacity style={styles.resultRow} onPress={() => focusOnEvent(item)} activeOpacity={0.75}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.resultImg} />
                    ) : (
                      <View style={[styles.resultImg, { backgroundColor: color + '20', alignItems: 'center', justifyContent: 'center' }]}>
                        <View style={[styles.resultImgDot, { backgroundColor: color }]} />
                      </View>
                    )}
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                      <View style={styles.resultMeta}>
                        <MapPin size={11} color="rgba(255,255,255,0.4)" />
                        <Text style={styles.resultMetaTxt} numberOfLines={1}>{item.location}</Text>
                        <Text style={[styles.resultDist, { color }]}>{item._distanceKm.toFixed(1)}km</Text>
                      </View>
                    </View>
                    <View style={[styles.resultPriceBadge, { backgroundColor: color + '20' }]}>
                      <Text style={[styles.resultPrice, { color }]}>{formatPrice(item.price)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListFooterComponent={
                searchText.trim().length > 1 ? (
                  <TouchableOpacity onPress={() => void geocodeSearch(searchText)} style={styles.geocodeRow}>
                    <MapPin size={14} color={Colors.dark.primary} />
                    <Text style={styles.geocodeTxt}>{`Buscar "${searchText}" en el mapa`}</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          </Animated.View>
        )}

        {showResults && searchResults.length === 0 && searchText.trim().length > 1 && (
          <Animated.View entering={FadeIn.duration(180)} style={styles.noResults}>
            <Text style={styles.noResultsTxt}>{`Sin resultados para "${searchText}"`}</Text>
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
          style={[styles.cardWrap, { paddingBottom: tabBarH + 10 + Math.max(0, insets.bottom - 2) }]}
          entering={SlideInDown.springify().damping(20).stiffness(260)}
          exiting={SlideOutDown.duration(180)}
        >
          <View style={styles.card}>
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

// ─── Export for tests ─────────────────────────────────────────────────────────
type TestRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
type TestMarker =
  | { kind: 'event'; key: string; event: AppEvent; latitude: number; longitude: number; color: string }
  | { kind: 'cluster'; key: string; count: number; latitude: number; longitude: number; color: string };

/** Deterministic, dependency-free clustering used by unit/stress tests. */
export function __test_clusterForRegion(
  events: EventWithGeo[],
  region: TestRegion,
  getColor: (event: AppEvent) => string,
): TestMarker[] {
  if (!events.length || region.latitudeDelta <= 0 || region.longitudeDelta <= 0) return [];
  const minLat = region.latitude - region.latitudeDelta / 2;
  const maxLat = region.latitude + region.latitudeDelta / 2;
  const minLng = region.longitude - region.longitudeDelta / 2;
  const maxLng = region.longitude + region.longitudeDelta / 2;
  const visible = events.filter((event) =>
    event._lat >= minLat && event._lat <= maxLat && event._lng >= minLng && event._lng <= maxLng,
  );
  if (!visible.length) return [];

  const columns = 16;
  const rows = 16;
  const buckets = new Map<string, EventWithGeo[]>();
  for (const event of visible) {
    const x = Math.min(columns - 1, Math.max(0, Math.floor(((event._lng - minLng) / region.longitudeDelta) * columns)));
    const y = Math.min(rows - 1, Math.max(0, Math.floor(((event._lat - minLat) / region.latitudeDelta) * rows)));
    const key = `${x}:${y}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(event);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, bucket]) => {
    if (bucket.length === 1) {
      const event = bucket[0];
      return { kind: 'event' as const, key: `event:${event.id}`, event, latitude: event._lat, longitude: event._lng, color: getColor(event) };
    }
    return {
      kind: 'cluster' as const,
      key: `cluster:${key}`,
      count: bucket.length,
      latitude: bucket.reduce((sum, event) => sum + event._lat, 0) / bucket.length,
      longitude: bucket.reduce((sum, event) => sum + event._lng, 0) / bucket.length,
      color: getColor(bucket[0]),
    };
  });
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#08080F' },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  loadingTxt: { color: 'rgba(255,255,255,0.5)', fontWeight: '700', marginTop: 8 },

  topOverlay:     { position: 'absolute', left: 14, right: 14, zIndex: 40 },
  searchBar:      { borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(8,8,15,0.88)', overflow: 'hidden' },
  searchRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  searchIconWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  searchInput:    { flex: 1, color: 'white', fontWeight: '700', fontSize: 15, paddingVertical: 0, letterSpacing: -0.2 },

  filterRow:     { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  filterChip:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(8,8,18,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  filterChipTxt: { color: 'rgba(255,255,255,0.80)', fontWeight: '800', fontSize: 11 },

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

  cardWrap:          { position: 'absolute', left: 12, right: 12, bottom: 0, zIndex: 30 },
  card:              { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: '#0c0c1a' },
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
