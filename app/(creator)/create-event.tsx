import { LAUNCH_FEATURES } from '@/lib/launchFeatures';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import WebView from 'react-native-webview';
import {
  buildTicketName,
  createEmptyTicketDraft,
  getTicketDraftErrors,
  parsePositiveInt,
  parsePositiveNumber,
  serializeTicketMetadata,
  type TicketDraft,
} from '@/lib/createEventTicketConfig';
import { uploadImage } from '@/lib/storage';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { useEvents } from '@/lib/EventContext';
import {
  ArrowLeft,
  Calendar,
  Camera,
  Check,
  Clock,
  DollarSign,
  Image as ImageIcon,
  Lock,
  MapPin,
  Navigation,
  Plus,
  Sparkles,
  Tag,
  Ticket,
  Trash2,
  X,
} from '@/lib/icons';

type EventDraft = {
  title: string;
  description: string;
  location: string;
  imageUri: string;
  venuePlanUri: string;
  theme: string;
  dressCode: string;
  ageRestriction: string;
  eventType: string;
  allowResale: boolean;
  dateTime: Date | null;
  endDateTime: Date | null;
  coordinates: { latitude: number; longitude: number } | null;
};

const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY || '';

function buildLocationPickerHtml(
  centerLat: number,
  centerLng: number,
  pin: { latitude: number; longitude: number } | null,
): string {
  const pinJs = pin
    ? `setPickerPin(${pin.latitude},${pin.longitude},false);`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:#0d1117;overflow:hidden;-webkit-tap-highlight-color:transparent}
#map{width:100%;height:100%;cursor:crosshair}
.maplibregl-ctrl-attrib,.maplibregl-ctrl-logo,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-bottom-left{display:none!important}
#pin{position:absolute;display:none;transform:translate(-50%,-100%);pointer-events:none;z-index:10}
#pin svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))}
</style>
</head>
<body>
<div id="map"></div>
<div id="pin">
  <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.667 16 26 16 26S32 26.667 32 16C32 7.163 24.837 0 16 0z" fill="#A78BFA"/>
    <circle cx="16" cy="16" r="7" fill="white"/>
  </svg>
</div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
var RN=window.ReactNativeWebView;
function post(o){try{RN.postMessage(JSON.stringify(o));}catch(e){}}

var pinEl=document.getElementById('pin');
var pinMarker=null;

var map=new maplibregl.Map({
  container:'map',
  style:'https://api.maptiler.com/maps/streets-v4/style.json?key=${MAPTILER_KEY}',
  center:[${centerLng},${centerLat}],
  zoom:14,
  attributionControl:false,
  fadeDuration:200,
});

window.setPickerPin=function(lat,lng,fly){
  if(pinMarker){pinMarker.remove();}
  var el=document.createElement('div');
  el.style.cssText='width:32px;height:42px;cursor:default;';
  el.innerHTML=pinEl.innerHTML;
  pinMarker=new maplibregl.Marker({element:el,anchor:'bottom'})
    .setLngLat([lng,lat]).addTo(map);
  if(fly){map.flyTo({center:[lng,lat],zoom:15,duration:600});}
};

map.on('click',function(e){
  var lat=e.lngLat.lat,lng=e.lngLat.lng;
  window.setPickerPin(lat,lng,false);
  post({type:'pinDrop',lat:lat,lng:lng});
});

map.on('load',function(){
  ${pinJs}
  post({type:'ready'});
});
</script>
</body>
</html>`;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toHM(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nextRoundedDateTime(now: Date) {
  const d = new Date(now);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  const rounded = Math.ceil(m / 5) * 5;
  d.setMinutes(rounded);
  if (rounded >= 60) d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

export default function CreateEventScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { addEvent, updateEvent } = useEvents();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ id?: string; isEditing?: string }>();
  const eventId = String(params.id ?? '').trim();
  const isEditing = eventId.length > 0;

  const minDateTime = useMemo(() => nextRoundedDateTime(new Date()), []);

  const [draft, setDraft] = useState<EventDraft>({
    title: '',
    description: '',
    location: '',
    imageUri: '',
    venuePlanUri: '',
    theme: '',
    dressCode: '',
    ageRestriction: '18',
    eventType: 'party',
    allowResale: LAUNCH_FEATURES.resale,
    dateTime: null,
    endDateTime: null,
    coordinates: null,
  });

  const [newTicket, setNewTicket] = useState<TicketDraft>(() => createEmptyTicketDraft());
  const [ticketTypes, setTicketTypes] = useState<TicketDraft[]>([]);

  const [loading, setLoading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [showIosDateTime, setShowIosDateTime] = useState(false);
  const [iosDateTimeDraft, setIosDateTimeDraft] = useState<Date>(() => nextRoundedDateTime(new Date()));
  const iosDateTimeDraftRef = useRef<Date>(iosDateTimeDraft);

  const [showIosEndDateTime, setShowIosEndDateTime] = useState(false);
  const [iosEndDateTimeDraft, setIosEndDateTimeDraft] = useState<Date>(() => nextRoundedDateTime(new Date()));
  const iosEndDateTimeDraftRef = useRef<Date>(iosEndDateTimeDraft);

  const [showMapModal, setShowMapModal] = useState(false);
  const [mapSelection, setMapSelection] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapPickerHtml, setMapPickerHtml] = useState<string | null>(null);
  const mapWebViewRef = useRef<WebView>(null);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);

  const [locationQuery, setLocationQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearchSuggestions, setMapSearchSuggestions] = useState<{ id: string; name: string; lat: number; lng: number }[]>([]);
  const mapGeoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // Load event data directly from Supabase when editing
  useEffect(() => {
    if (!isEditing || !eventId) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('*, venues(*), event_ticket_types(*)')
          .eq('id', eventId)
          .single();
        if (error || !data) {
          Alert.alert('No se pudo cargar el evento', 'Inténtalo de nuevo en unos segundos.', [
            { text: 'Volver', onPress: () => router.back() },
          ]);
          return;
        }
        const rawDate = data.event_date ? new Date(data.event_date) : null;
        const rawEnd = data.end_datetime ? new Date(data.end_datetime) : null;
        setDraft({
          title: data.title ?? '',
          description: data.description ?? '',
          location: data.venues?.name ?? '',
          imageUri: data.poster_url ?? '',
          venuePlanUri: data.venue_plan_url ?? '',
          theme: data.theme ?? '',
          dressCode: data.dress_code ?? '',
          ageRestriction: String(data.age_restriction ?? '18'),
          eventType: data.event_type ?? 'party',
          allowResale: data.allow_resale ?? true,
          dateTime: rawDate,
          endDateTime: rawEnd,
          coordinates: data.venues
            ? { latitude: data.venues.latitude, longitude: data.venues.longitude }
            : null,
        });
        if (data.venues?.name) setLocationQuery(data.venues.name);
        if (Array.isArray(data.event_ticket_types) && data.event_ticket_types.length > 0) {
          const validCats = ['general', 'vip', 'early', 'backstage'];
          const active = data.event_ticket_types.filter((t: any) => !t.deleted_at && (t.is_active ?? true));
          setTicketTypes(active.map((t: any) => ({
            id: t.id,
            name: t.name ?? '',
            category: (validCats.includes(t.category ?? '') ? t.category : 'general'),
            price: String(t.price ?? 0),
            quantity: String(t.quantity ?? 0),
            benefits: t.metadata?.benefits || '',
            featured: !!t.metadata?.featured,
            vipGroupSize: t.metadata?.vipGroupSize ? String(t.metadata.vipGroupSize) : '',
            vipFreeBottles: (t.metadata?.vipBottles || []).map((b: any) => ({ brand: b.brand || '', quantity: String(b.quantity || 1) })),
            generalAccessZone: t.metadata?.accessZone || '',
            generalNumberedSeat: !!t.metadata?.numberedSeat,
            earlyEntryMinutes: t.metadata?.earlyEntryMinutes ? String(t.metadata.earlyEntryMinutes) : '',
            entryDeadlineMinutes: t.metadata?.entryDeadlineMinutes != null ? String(t.metadata.entryDeadlineMinutes) : '',
            earlyDedicatedLane: !!t.metadata?.dedicatedLane,
            backstageMeetGreet: !!t.metadata?.backstageMeetGreet,
            backstageHost: t.metadata?.backstageHost || '',
          })));
        }
      } catch {
        Alert.alert('No se pudo cargar el evento', 'Comprueba tu conexión e inténtalo de nuevo.', [
          { text: 'Volver', onPress: () => router.back() },
        ]);
      }
    })();
  }, [eventId, isEditing, router]);
  const eventTypeOptions = useMemo(
    () => [
      { key: 'party', label: 'Fiesta', Icon: Sparkles },
      { key: 'concert', label: 'Concierto', Icon: Ticket },
      { key: 'festival', label: 'Festival', Icon: Sparkles },
      { key: 'private', label: 'Privado', Icon: Lock },
      { key: 'other', label: 'Otro', Icon: Tag },
    ],
    []
  );

  const ticketCategories = useMemo(
    () => [
      { key: 'general' as const, label: 'General' },
      { key: 'vip' as const, label: 'VIP' },
      { key: 'early' as const, label: 'Early' },
      { key: 'backstage' as const, label: 'Backstage' },
    ],
    []
  );

  const metrics = useMemo(() => {
    const parsed = ticketTypes
      .map((ticket) => ({
        price: parsePositiveNumber(ticket.price),
        quantity: parsePositiveInt(ticket.quantity),
      }))
      .filter((ticket) => ticket.price !== null && ticket.quantity !== null) as { price: number; quantity: number }[];

    const capacity = parsed.reduce((sum, ticket) => sum + ticket.quantity, 0);
    const minPrice = parsed.length ? Math.min(...parsed.map((ticket) => ticket.price)) : null;
    return { capacity, minPrice };
  }, [ticketTypes]);

  const uiDateTimeText = useMemo(() => {
    if (!draft.dateTime) return 'Seleccionar fecha y hora';
    return `${draft.dateTime.toLocaleDateString()} • ${toHM(draft.dateTime)}`;
  }, [draft.dateTime]);

  const uiEndDateTimeText = useMemo(() => {
    if (!draft.endDateTime) return 'Seleccionar fecha y hora de fin';
    return `${draft.endDateTime.toLocaleDateString()} • ${toHM(draft.endDateTime)}`;
  }, [draft.endDateTime]);

  const newTicketErrors = useMemo(() => getTicketDraftErrors(newTicket), [newTicket]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};

    if (!draft.title.trim()) e.title = 'Obligatorio.';
    else if (draft.title.length > 100) e.title = 'El título no puede superar 100 caracteres';
    if (!draft.description.trim()) e.description = 'Obligatorio.';
    else if (draft.description.length > 2000) e.description = 'La descripción no puede superar 2.000 caracteres';
    if (!draft.location.trim()) e.location = 'Selecciona la ubicación en el mapa.';
    if (!draft.imageUri.trim() && !isEditing) e.imageUri = 'Selecciona un cartel desde la cámara o la galería.';

    const age = parsePositiveInt(draft.ageRestriction);
    if (age === null || age < 16 || age > 99) e.ageRestriction = 'Edad mínima permitida: 16 años.';

    if (!draft.dateTime || !Number.isFinite(draft.dateTime.getTime())) {
      e.dateTime = 'Selecciona fecha y hora.';
    } else if (!isEditing && draft.dateTime.getTime() < minDateTime.getTime()) {
      e.dateTime = 'Debe ser una fecha/hora futura.';
    } else {
      const maxFutureDate = new Date();
      maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 5);
      if (draft.dateTime.getTime() > maxFutureDate.getTime()) {
        e.dateTime = 'La fecha no puede ser más de 5 años en el futuro';
      }
    }

    if (!draft.endDateTime || !Number.isFinite(draft.endDateTime.getTime())) {
      e.endDateTime = 'Selecciona la fecha y hora de finalización.';
    } else if (draft.dateTime && draft.endDateTime.getTime() <= draft.dateTime.getTime()) {
      e.endDateTime = 'Debe ser posterior a la fecha de inicio.';
    }

    if (!draft.coordinates) e.coordinates = 'Marca la ubicación exacta del evento.';

    if (ticketTypes.length === 0) {
      e.ticketTypes = 'Añade al menos un tipo de entrada.';
    }

    return e;
  }, [draft, isEditing, minDateTime, ticketTypes.length]);

  const getError = useCallback(
    (key: string) => {
      if (!submitAttempted) return undefined;
      return errors[key];
    },
    [errors, submitAttempted]
  );

  const safeBack = useCallback(() => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  }, [router]);

  const updateDraft = useCallback((key: keyof EventDraft, value: EventDraft[keyof EventDraft]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const selectImage = useCallback(
    async (field: 'imageUri' | 'venuePlanUri', source: 'camera' | 'gallery') => {
      try {
        let result: ImagePicker.ImagePickerResult;

        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (permission.status !== 'granted') {
            Alert.alert('Permiso requerido', 'Necesitas dar acceso a la cámara.');
            return;
          }
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: false,
            quality: 0.8,
          });
        } else {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (permission.status !== 'granted') {
            Alert.alert('Permiso requerido', 'Necesitas dar acceso a la galería.');
            return;
          }
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            quality: 0.85,
          });
        }

        if (!result.canceled && result.assets?.[0]?.uri) {
          updateDraft(field, result.assets[0].uri);
        }
      } catch (e: any) {
        Alert.alert('Error', String(e?.message || 'No se pudo seleccionar la imagen.'));
      }
    },
    [updateDraft]
  );

  const chooseImageSource = useCallback(
    (field: 'imageUri' | 'venuePlanUri') => {
      Alert.alert('Seleccionar imagen', 'Elige cómo quieres subir la imagen.', [
        { text: 'Cámara', onPress: () => void selectImage(field, 'camera') },
        { text: 'Galería', onPress: () => void selectImage(field, 'gallery') },
        { text: 'Cancelar', style: 'cancel' },
      ]);
    },
    [selectImage]
  );

  const openMapPicker = useCallback(async () => {
    Keyboard.dismiss();
    let centerLat = 37.3891;
    let centerLng = -5.9845;

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status === 'granted') {
        const current = await Location.getCurrentPositionAsync({});
        centerLat = current.coords.latitude;
        centerLng = current.coords.longitude;
      }
    } catch {}

    if (draft.coordinates) {
      centerLat = draft.coordinates.latitude;
      centerLng = draft.coordinates.longitude;
      setMapSelection(draft.coordinates);
    } else {
      setMapSelection(null);
    }

    setMapPickerHtml(buildLocationPickerHtml(
      centerLat, centerLng,
      draft.coordinates ?? null,
    ));
    setShowMapModal(true);
  }, [draft.coordinates]);

  const searchGeocode = useCallback(async (q: string): Promise<{ id: string; name: string; lat: number; lng: number }[]> => {
    if (q.trim().length < 3) return [];
    try {
      const res = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q.trim())}.json?key=${MAPTILER_KEY}&language=es&limit=5`);
      const json = await res.json() as { features?: any[] };
      return (json.features ?? []).map((f: any) => ({
        id: String(f.id),
        name: String(f.place_name ?? f.text ?? ''),
        lat: f.center[1] as number,
        lng: f.center[0] as number,
      }));
    } catch { return []; }
  }, []);

  const onLocationQueryChange = useCallback((text: string) => {
    setLocationQuery(text);
    setShowSuggestions(true);
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    if (text.trim().length < 3) { setLocationSuggestions([]); return; }
    geocodeTimerRef.current = setTimeout(() => {
      void searchGeocode(text).then(setLocationSuggestions);
    }, 400);
  }, [searchGeocode]);

  const selectLocationSuggestion = useCallback((s: { id: string; name: string; lat: number; lng: number }) => {
    setLocationQuery(s.name);
    updateDraft('location', s.name);
    updateDraft('coordinates', { latitude: s.lat, longitude: s.lng });
    setLocationSuggestions([]);
    setShowSuggestions(false);
    Keyboard.dismiss();
  }, [updateDraft]);

  const onMapSearchChange = useCallback((text: string) => {
    setMapSearchQuery(text);
    if (mapGeoTimerRef.current) clearTimeout(mapGeoTimerRef.current);
    if (text.trim().length < 3) { setMapSearchSuggestions([]); return; }
    mapGeoTimerRef.current = setTimeout(() => {
      void searchGeocode(text).then(setMapSearchSuggestions);
    }, 400);
  }, [searchGeocode]);

  const selectMapSuggestion = useCallback((s: { id: string; name: string; lat: number; lng: number }) => {
    setMapSearchQuery(s.name);
    setMapSearchSuggestions([]);
    setMapSelection({ latitude: s.lat, longitude: s.lng });
    mapWebViewRef.current?.injectJavaScript(
      `window.setPickerPin(${s.lat},${s.lng},true);true;`
    );
    Keyboard.dismiss();
  }, []);

  const reverseGeocodeSelection = useCallback(async (coords: { latitude: number; longitude: number }) => {
    try {
      setIsResolvingAddress(true);
      updateDraft('location', '');
      const places = await Location.reverseGeocodeAsync(coords);
      const place = places?.[0];
      const parts = [
        place?.street && place?.streetNumber ? `${place.street} ${place.streetNumber}` : place?.street,
        place?.district || place?.subregion,
        place?.city,
      ].filter(Boolean) as string[];
      const addr = parts.length ? parts.join(', ') : `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
      updateDraft('location', addr);
      setLocationQuery(addr);
    } catch {
      const fallback = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
      updateDraft('location', fallback);
      setLocationQuery(fallback);
    } finally {
      setIsResolvingAddress(false);
    }
  }, [updateDraft]);

  const confirmMapLocation = useCallback(async () => {
    if (!mapSelection) {
      Alert.alert('Ubicación', 'Marca primero el punto exacto en el mapa.');
      return;
    }
    updateDraft('coordinates', mapSelection);
    // Always reverse geocode to get street address when user confirms a map point
    await reverseGeocodeSelection(mapSelection);
    setShowMapModal(false);
  }, [mapSelection, reverseGeocodeSelection, updateDraft]);

  const onMapWebViewMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'pinDrop') {
        setMapSelection({ latitude: msg.lat, longitude: msg.lng });
      }
    } catch {}
  }, []);

  const openDateTimePicker = useCallback(() => {
    Keyboard.dismiss();
    const base = draft.dateTime && Number.isFinite(draft.dateTime.getTime()) ? new Date(draft.dateTime) : new Date(minDateTime);

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        minimumDate: minDateTime,
        onChange: (event, selectedDate) => {
          if (event.type !== 'set' || !selectedDate) return;
          const next = new Date(base);
          next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
          DateTimePickerAndroid.open({
            value: next,
            mode: 'time',
            is24Hour: true,
            onChange: (timeEvent, selectedTime) => {
              if (timeEvent.type !== 'set' || !selectedTime) return;
              next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
              updateDraft('dateTime', new Date(next));
            },
          });
        },
      });
      return;
    }

    if (Platform.OS === 'ios') {
      setIosDateTimeDraft(base);
      iosDateTimeDraftRef.current = base;
      setShowIosDateTime(true);
    }
  }, [draft.dateTime, minDateTime, updateDraft]);

  const onIosDateTimeChange = useCallback((event: any, selectedDate?: Date) => {
    if (event?.type && event.type !== 'set') return;
    if (!selectedDate || !Number.isFinite(selectedDate.getTime())) return;
    const next = new Date(selectedDate);
    iosDateTimeDraftRef.current = next;
    setIosDateTimeDraft(next);
  }, []);

  const confirmIosDateTime = useCallback(() => {
    const next = iosDateTimeDraftRef.current;
    if (!next || !Number.isFinite(next.getTime())) {
      setShowIosDateTime(false);
      return;
    }
    updateDraft('dateTime', next.getTime() < minDateTime.getTime() ? new Date(minDateTime) : new Date(next));
    setShowIosDateTime(false);
  }, [minDateTime, updateDraft]);

  const openEndDateTimePicker = useCallback(() => {
    Keyboard.dismiss();
    const startBase = draft.dateTime && Number.isFinite(draft.dateTime.getTime()) ? new Date(draft.dateTime) : new Date(minDateTime);
    const base = draft.endDateTime && Number.isFinite(draft.endDateTime.getTime())
      ? new Date(draft.endDateTime)
      : new Date(startBase.getTime() + 4 * 60 * 60 * 1000); // default +4h from start

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        minimumDate: draft.dateTime ?? minDateTime,
        onChange: (event, selectedDate) => {
          if (event.type !== 'set' || !selectedDate) return;
          const next = new Date(base);
          next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
          DateTimePickerAndroid.open({
            value: next,
            mode: 'time',
            is24Hour: true,
            onChange: (timeEvent, selectedTime) => {
              if (timeEvent.type !== 'set' || !selectedTime) return;
              next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
              updateDraft('endDateTime', new Date(next));
            },
          });
        },
      });
      return;
    }
    if (Platform.OS === 'ios') {
      setIosEndDateTimeDraft(base);
      iosEndDateTimeDraftRef.current = base;
      setShowIosEndDateTime(true);
    }
  }, [draft.dateTime, draft.endDateTime, minDateTime, updateDraft]);

  const onIosEndDateTimeChange = useCallback((event: any, selectedDate?: Date) => {
    if (event?.type && event.type !== 'set') return;
    if (!selectedDate || !Number.isFinite(selectedDate.getTime())) return;
    iosEndDateTimeDraftRef.current = new Date(selectedDate);
    setIosEndDateTimeDraft(new Date(selectedDate));
  }, []);

  const confirmIosEndDateTime = useCallback(() => {
    const next = iosEndDateTimeDraftRef.current;
    if (!next || !Number.isFinite(next.getTime())) { setShowIosEndDateTime(false); return; }
    updateDraft('endDateTime', new Date(next));
    setShowIosEndDateTime(false);
  }, [updateDraft]);

  const addTicketType = useCallback(() => {
    const ticketErrors = getTicketDraftErrors(newTicket);
    const name = newTicket.name.trim();
    const price = parsePositiveNumber(newTicket.price);
    const quantity = parsePositiveInt(newTicket.quantity);

    if (Object.keys(ticketErrors).length > 0 || !name || price === null || quantity === null) {
      setSubmitAttempted(true);
      Alert.alert('Entradas', 'Revisa los campos personalizados de esta entrada.');
      return;
    }

    const entry: TicketDraft = {
      ...newTicket,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      price: String(price),
      quantity: String(quantity),
      benefits: newTicket.benefits.trim(),
    };

    setTicketTypes((prev) => [...prev, entry]);
    setNewTicket(createEmptyTicketDraft());
  }, [newTicket]);

  const removeTicketType = useCallback((id: string) => {
    setTicketTypes((prev) => prev.filter((ticket) => ticket.id !== id));
  }, []);

  const submit = useCallback(async () => {
    setSubmitAttempted(true);
    if (Object.keys(errors).length > 0) {
      Alert.alert('Revisa el formulario', 'Hay campos pendientes o inválidos.');
      return;
    }
    if (!user?.id) {
      Alert.alert('Error', 'No se pudo identificar tu usuario.');
      return;
    }
    if (!draft.coordinates || !draft.dateTime) {
      Alert.alert('Error', 'Faltan datos obligatorios del evento.');
      return;
    }

    setLoading(true);
    try {
      const imageIsRemote = draft.imageUri.startsWith('http');
      const uploadedPoster = imageIsRemote ? draft.imageUri : await uploadImage(draft.imageUri, 'events');
      if (!uploadedPoster) throw new Error('No se pudo subir el cartel del evento.');

      let uploadedPlan = '';
      if (draft.venuePlanUri.trim()) {
        const planIsRemote = draft.venuePlanUri.startsWith('http');
        const uploaded = planIsRemote ? draft.venuePlanUri : await uploadImage(draft.venuePlanUri, 'events');
        if (!uploaded) throw new Error('No se pudo subir el plano del recinto.');
        uploadedPlan = uploaded;
      }

      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const mappedTicketTypes = ticketTypes.map((ticket) => ({
        id: ticket.id,
        // Existing tickets (UUID id) already have the formatted name stored in the DB.
        // Only new tickets (temp id) need buildTicketName to generate one.
        name: uuidRe.test(String(ticket.id)) ? ticket.name : buildTicketName(ticket),
        price: parsePositiveNumber(ticket.price) || 0,
        quantity: parsePositiveInt(ticket.quantity) || 0,
        sold: 0,
        category: ticket.category,
        metadata: serializeTicketMetadata(ticket),
      }));

      const eventPayload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        location: draft.location.trim(),
        imageUrl: uploadedPoster,
        venuePlanUrl: uploadedPlan,
        theme: draft.theme.trim(),
        ageRestriction: draft.ageRestriction.trim(),
        dressCode: draft.dressCode.trim(),
        eventType: draft.eventType,
        allowResale: draft.allowResale,
        date: toYMD(draft.dateTime),
        time: toHM(draft.dateTime),
        endDatetime: draft.endDateTime ? draft.endDateTime.toISOString() : undefined,
        price: String(metrics.minPrice ?? 0),
        capacity: metrics.capacity,
        ticketTypes: mappedTicketTypes,
        venues: {
          latitude: draft.coordinates.latitude,
          longitude: draft.coordinates.longitude,
          name: draft.location.trim(),
        },
      };

      if (isEditing && eventId) {
        await updateEvent(eventId, eventPayload);
        setLoading(false);
        Alert.alert('Evento actualizado', 'Los cambios se han guardado correctamente.', [{ text: 'OK', onPress: safeBack }]);
      } else {
        await addEvent({ ...eventPayload, creatorId: user.id });
        setLoading(false);
        Alert.alert('Evento creado', 'El evento se ha creado correctamente.', [{ text: 'OK', onPress: safeBack }]);
      }
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Error', String(e?.message || 'No se pudo crear el evento.'));
    }
  }, [addEvent, updateEvent, isEditing, eventId, draft, errors, metrics.capacity, metrics.minPrice, safeBack, ticketTypes, user?.id]);

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1e1b4b']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <GlassView intensity={20} style={styles.backButtonContainer}>
              <ArrowLeft size={24} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{isEditing ? 'Editar evento' : 'Crear evento'}</Text>
            <Text style={styles.headerSubtitle}>{isEditing ? 'Modifica los detalles y guarda los cambios.' : 'Completa todo y publícalo con imágenes, mapa y entradas personalizadas.'}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Información básica</Text>
            <ThemedInput
              label="Nombre"
              placeholder="Nombre del evento"
              value={draft.title}
              onChangeText={(value) => updateDraft('title', value)}
              error={getError('title')}
              icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              maxLength={100}
            />
            <ThemedInput
              label="Descripción"
              placeholder="Describe el evento"
              value={draft.description}
              onChangeText={(value) => updateDraft('description', value)}
              error={getError('description')}
              multiline
              numberOfLines={4}
              maxLength={2000}
              containerStyle={{ minHeight: 120 }}
            />
            <Text style={styles.fieldLabel}>Tipo de evento</Text>
            <View style={styles.chipsRow}>
              {eventTypeOptions.map(({ key, label, Icon }) => {
                const selected = draft.eventType === key;
                return (
                  <Pressable key={key} onPress={() => updateDraft('eventType', key)} style={[styles.chip, selected ? styles.chipActive : null]}>
                    <Icon size={16} color={selected ? '#fff' : Colors.dark.textSecondary} />
                    <Text style={[styles.chipText, selected ? styles.chipTextActive : null]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Fecha y hora</Text>
            <TouchableOpacity onPress={openDateTimePicker} activeOpacity={0.85}>
              <View pointerEvents="none">
                <ThemedInput
                  label="Inicio del evento *"
                  value={uiDateTimeText}
                  editable={false}
                  error={getError('dateTime')}
                  icon={<Calendar size={20} color={Colors.dark.textSecondary} />}
                  rightIcon={<Clock size={18} color={Colors.dark.textSecondary} />}
                />
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={openEndDateTimePicker} activeOpacity={0.85} style={{ marginTop: 12 }}>
              <View pointerEvents="none">
                <ThemedInput
                  label="Fin del evento *"
                  value={uiEndDateTimeText}
                  editable={false}
                  error={getError('endDateTime')}
                  icon={<Calendar size={20} color={Colors.dark.textSecondary} />}
                  rightIcon={<Clock size={18} color={Colors.dark.textSecondary} />}
                />
              </View>
            </TouchableOpacity>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8, lineHeight: 16 }}>
              Al finalizar el evento se eliminarán automáticamente las entradas caducadas.
            </Text>
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Ubicación</Text>
              <ThemedButton
                title="Ver mapa"
                onPress={openMapPicker}
                variant="outline"
                style={styles.smallButton}
                textStyle={{ fontSize: 13 }}
                icon={<MapPin size={16} color={Colors.dark.primary} />}
              />
            </View>
            <View>
              <ThemedInput
                label="Lugar"
                placeholder="Escribe la dirección o busca en el mapa"
                value={locationQuery}
                onChangeText={onLocationQueryChange}
                onFocus={() => locationQuery.trim().length >= 3 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                error={getError('location') || getError('coordinates')}
                icon={<MapPin size={20} color={Colors.dark.textSecondary} />}
                returnKeyType="search"
                onSubmitEditing={() => { setShowSuggestions(false); Keyboard.dismiss(); }}
              />
              {showSuggestions && locationSuggestions.length > 0 && (
                <View style={styles.suggestionsBox}>
                  {locationSuggestions.map((s, i) => (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => selectLocationSuggestion(s)}
                      style={[styles.suggestionItem, i < locationSuggestions.length - 1 && styles.suggestionItemBorder]}
                    >
                      <MapPin size={14} color={Colors.dark.primary} style={{ marginTop: 1 }} />
                      <Text style={styles.suggestionText} numberOfLines={2}>{s.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            {draft.coordinates && !isResolvingAddress ? (
              <View style={styles.locationPreview}>
                <Navigation size={13} color={Colors.dark.primary} />
                <Text style={styles.locationPreviewText} numberOfLines={2}>
                  {draft.location.trim() || `${draft.coordinates.latitude.toFixed(5)}, ${draft.coordinates.longitude.toFixed(5)}`}
                </Text>
              </View>
            ) : isResolvingAddress ? (
              <View style={styles.locationPreview}>
                <Text style={styles.locationPreviewText}>Resolviendo dirección…</Text>
              </View>
            ) : null}
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Imágenes</Text>
            <View style={styles.imageGrid}>
              <View style={styles.imageCol}>
                <Text style={styles.fieldLabel}>Cartel del evento</Text>
                <TouchableOpacity onPress={() => chooseImageSource('imageUri')} activeOpacity={0.85}>
                  <GlassView intensity={10} style={[styles.imageSelector, getError('imageUri') ? styles.imageSelectorError : null]}>
                    {draft.imageUri ? (
                      <Image source={{ uri: draft.imageUri }} style={styles.imagePreview} resizeMode="cover" />
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <Camera size={26} color={Colors.dark.textSecondary} />
                        <Text style={styles.imagePlaceholderText}>Camara o galería</Text>
                      </View>
                    )}
                  </GlassView>
                </TouchableOpacity>
                {getError('imageUri') ? <Text style={styles.errorText}>{getError('imageUri')}</Text> : null}
              </View>

              <View style={styles.imageCol}>
                <Text style={styles.fieldLabel}>Plano del recinto</Text>
                <TouchableOpacity onPress={() => chooseImageSource('venuePlanUri')} activeOpacity={0.85}>
                  <GlassView intensity={10} style={styles.imageSelector}>
                    {draft.venuePlanUri ? (
                      <Image source={{ uri: draft.venuePlanUri }} style={styles.imagePreview} resizeMode="cover" />
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <ImageIcon size={26} color={Colors.dark.textSecondary} />
                        <Text style={styles.imagePlaceholderText}>Opcional</Text>
                      </View>
                    )}
                  </GlassView>
                </TouchableOpacity>
              </View>
            </View>
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Tipos de entrada</Text>
            <Text style={styles.helperText}>
              Configura entradas generales, VIP, early access o backstage con nombre, precio, cupo y beneficios.
            </Text>

            <Text style={styles.fieldLabel}>Categoría</Text>
            <View style={styles.chipsRow}>
              {ticketCategories.map((category) => {
                const selected = newTicket.category === category.key;
                return (
                  <Pressable
                    key={category.key}
                    onPress={() => setNewTicket((prev) => ({ ...prev, category: category.key }))}
                    style={[styles.chip, selected ? styles.chipActive : null]}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextActive : null]}>{category.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <ThemedInput
              label="Nombre de la entrada"
              placeholder="Ej: Acceso front stage"
              value={newTicket.name}
              onChangeText={(value) => setNewTicket((prev) => ({ ...prev, name: value }))}
              error={newTicketErrors.name}
              icon={<Ticket size={20} color={Colors.dark.textSecondary} />}
            />

            <View style={styles.row}>
              <View style={styles.half}>
                <ThemedInput
                  label="Precio (€)"
                  placeholder="0 para entrada gratis"
                  value={newTicket.price}
                  onChangeText={(value) => setNewTicket((prev) => ({ ...prev, price: value }))}
                  error={newTicketErrors.price}
                  keyboardType="numeric"
                  icon={<DollarSign size={20} color={Colors.dark.textSecondary} />}
                />
              </View>
              <View style={styles.half}>
                <ThemedInput
                  label="Cantidad"
                  placeholder="Ej: 150"
                  value={newTicket.quantity}
                  onChangeText={(value) => setNewTicket((prev) => ({ ...prev, quantity: value }))}
                  error={newTicketErrors.quantity}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <ThemedInput
              label="Límite de acceso (minutos desde el inicio, opcional)"
              placeholder="Ej: 120 = acceso hasta 2 horas después del inicio"
              value={newTicket.entryDeadlineMinutes || ''}
              onChangeText={(value) => setNewTicket((prev) => ({ ...prev, entryDeadlineMinutes: value }))}
              error={newTicketErrors.entryDeadlineMinutes}
              keyboardType="number-pad"
            />
            {!!newTicket.entryDeadlineMinutes && draft.dateTime && (
              <Text style={styles.metricsText}>Acceso antes de: {new Date(draft.dateTime.getTime() + Number(newTicket.entryDeadlineMinutes) * 60000).toLocaleString('es-ES')}</Text>
            )}
            <ThemedInput
              label="Beneficios / preferencias"
              placeholder="Ej: Fast lane, copa incluida, zona reservada"
              value={newTicket.benefits}
              onChangeText={(value) => setNewTicket((prev) => ({ ...prev, benefits: value }))}
              icon={<Sparkles size={20} color={Colors.dark.textSecondary} />}
            />

            {newTicket.category === 'vip' ? (
              <View style={styles.conditionalCard}>
                <Text style={styles.conditionalTitle}>Configuración VIP</Text>
                <ThemedInput
                  label="Personas incluidas"
                  placeholder="Ej: 5"
                  value={newTicket.vipGroupSize}
                  onChangeText={(value) => setNewTicket((prev) => ({ ...prev, vipGroupSize: value }))}
                  error={newTicketErrors.vipGroupSize}
                  keyboardType="numeric"
                />

                <Text style={styles.fieldLabel}>Botellas incluidas</Text>
                {(newTicket.vipFreeBottles || []).map((bottle, idx) => (
                  <View key={idx} style={styles.bottleRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedInput
                        label="Marca"
                        placeholder="Ej: Belvedere, Moët..."
                        value={bottle.brand}
                        onChangeText={(v) =>
                          setNewTicket((prev) => {
                            const arr = [...(prev.vipFreeBottles || [])];
                            arr[idx] = { ...arr[idx], brand: v };
                            return { ...prev, vipFreeBottles: arr };
                          })
                        }
                      />
                    </View>
                    <View style={styles.bottleQty}>
                      <ThemedInput
                        label="Uds"
                        placeholder="1"
                        value={bottle.quantity}
                        onChangeText={(v) =>
                          setNewTicket((prev) => {
                            const arr = [...(prev.vipFreeBottles || [])];
                            arr[idx] = { ...arr[idx], quantity: v };
                            return { ...prev, vipFreeBottles: arr };
                          })
                        }
                        error={newTicketErrors[`bottle.${idx}.quantity`]}
                        keyboardType="numeric"
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() =>
                        setNewTicket((prev) => ({
                          ...prev,
                          vipFreeBottles: (prev.vipFreeBottles || []).filter((_, i) => i !== idx),
                        }))
                      }
                      style={styles.bottleRemoveBtn}
                    >
                      <Trash2 size={18} color={Colors.dark.error} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  onPress={() =>
                    setNewTicket((prev) => ({
                      ...prev,
                      vipFreeBottles: [...(prev.vipFreeBottles || []), { brand: '', quantity: '1' }],
                    }))
                  }
                  style={styles.addBottleBtn}
                >
                  <Plus size={15} color={Colors.dark.primary} />
                  <Text style={styles.addBottleTxt}>Añadir botella</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {newTicket.category === 'general' ? (
              <View style={styles.conditionalCard}>
                <Text style={styles.conditionalTitle}>Configuración general</Text>
                <ThemedInput
                  label="Zona de acceso"
                  placeholder="Ej: Pista principal"
                  value={newTicket.generalAccessZone}
                  onChangeText={(value) => setNewTicket((prev) => ({ ...prev, generalAccessZone: value }))}
                  error={newTicketErrors.generalAccessZone}
                  icon={<MapPin size={20} color={Colors.dark.textSecondary} />}
                />
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Asiento numerado</Text>
                  <Pressable
                    onPress={() => setNewTicket((prev) => ({ ...prev, generalNumberedSeat: !prev.generalNumberedSeat }))}
                    style={[styles.switchPill, newTicket.generalNumberedSeat ? styles.switchPillOn : null]}
                  >
                    <Text style={styles.switchPillText}>{newTicket.generalNumberedSeat ? 'Sí' : 'No'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {newTicket.category === 'early' ? (
              <View style={styles.conditionalCard}>
                <Text style={styles.conditionalTitle}>Configuración early access</Text>
                <ThemedInput
                  label="Minutos de antelación"
                  placeholder="Ej: 45"
                  value={newTicket.earlyEntryMinutes}
                  onChangeText={(value) => setNewTicket((prev) => ({ ...prev, earlyEntryMinutes: value }))}
                  error={newTicketErrors.earlyEntryMinutes}
                  keyboardType="numeric"
                  icon={<Clock size={20} color={Colors.dark.textSecondary} />}
                />
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Carril prioritario</Text>
                  <Pressable
                    onPress={() => setNewTicket((prev) => ({ ...prev, earlyDedicatedLane: !prev.earlyDedicatedLane }))}
                    style={[styles.switchPill, newTicket.earlyDedicatedLane ? styles.switchPillOn : null]}
                  >
                    <Text style={styles.switchPillText}>{newTicket.earlyDedicatedLane ? 'Sí' : 'No'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {newTicket.category === 'backstage' ? (
              <View style={styles.conditionalCard}>
                <Text style={styles.conditionalTitle}>Configuración backstage</Text>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Meet & greet</Text>
                  <Pressable
                    onPress={() => setNewTicket((prev) => ({ ...prev, backstageMeetGreet: !prev.backstageMeetGreet }))}
                    style={[styles.switchPill, newTicket.backstageMeetGreet ? styles.switchPillOn : null]}
                  >
                    <Text style={styles.switchPillText}>{newTicket.backstageMeetGreet ? 'Sí' : 'No'}</Text>
                  </Pressable>
                </View>
                {newTicket.backstageMeetGreet ? (
                  <ThemedInput
                    label="Artista / anfitrión"
                    placeholder="Ej: DJ principal"
                    value={newTicket.backstageHost}
                    onChangeText={(value) => setNewTicket((prev) => ({ ...prev, backstageHost: value }))}
                    error={newTicketErrors.backstageHost}
                    icon={<Sparkles size={20} color={Colors.dark.textSecondary} />}
                  />
                ) : null}
              </View>
            ) : null}

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Destacar esta entrada</Text>
              <Pressable
                onPress={() => setNewTicket((prev) => ({ ...prev, featured: !prev.featured }))}
                style={[styles.switchPill, newTicket.featured ? styles.switchPillOn : null]}
              >
                <Text style={styles.switchPillText}>{newTicket.featured ? 'Sí' : 'No'}</Text>
              </Pressable>
            </View>

            <ThemedButton
              title="Añadir tipo de entrada"
              onPress={addTicketType}
              variant="outline"
              icon={<Plus size={18} color={Colors.dark.primary} />}
            />
            {getError('ticketTypes') ? <Text style={styles.errorText}>{getError('ticketTypes')}</Text> : null}

            {ticketTypes.length ? (
              <View style={styles.ticketList}>
                {ticketTypes.map((ticket) => (
                  <View key={ticket.id} style={styles.ticketCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ticketTitle}>{buildTicketName(ticket)}</Text>
                      <Text style={styles.ticketMeta}>
                        {Number(ticket.price).toFixed(2)}€ • {ticket.quantity} uds
                      </Text>
                      <Text style={styles.ticketMeta}>
                        {ticket.category === 'vip'
                          ? `VIP · ${ticket.vipGroupSize || '-'} personas`
                          : ticket.category === 'general'
                            ? `General · ${ticket.generalAccessZone || 'Zona libre'}`
                            : ticket.category === 'early'
                              ? `Early · ${ticket.earlyEntryMinutes || '0'} min antes`
                              : `Backstage${ticket.backstageMeetGreet ? ' · Meet & greet' : ''}`}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => removeTicketType(ticket.id)} style={styles.deleteButton}>
                      <Trash2 size={18} color={Colors.dark.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.metricsCard}>
              <Text style={styles.metricsTitle}>Resumen automático</Text>
              <Text style={styles.metricsText}>Precio base desde: {metrics.minPrice !== null ? `${metrics.minPrice.toFixed(2)}€` : '--'}</Text>
              <Text style={styles.metricsText}>Aforo total: {metrics.capacity}</Text>
            </View>
          </GlassView>

          <GlassView intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Detalles del evento</Text>
            <ThemedInput
              label="Música / temática"
              placeholder="Ej: Tech house"
              value={draft.theme}
              onChangeText={(value) => updateDraft('theme', value)}
              icon={<Sparkles size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Dress code"
              placeholder="Ej: Total black"
              value={draft.dressCode}
              onChangeText={(value) => updateDraft('dressCode', value)}
              icon={<Tag size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Edad mínima"
              placeholder="18"
              value={draft.ageRestriction}
              onChangeText={(value) => updateDraft('ageRestriction', value)}
              error={getError('ageRestriction')}
              keyboardType="numeric"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              icon={<Lock size={20} color={Colors.dark.textSecondary} />}
            />

            {LAUNCH_FEATURES.resale && (<View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Permitir reventa</Text>
              <Pressable onPress={() => updateDraft('allowResale', !draft.allowResale)} style={[styles.switchPill, draft.allowResale ? styles.switchPillOn : null]}>
                <Text style={styles.switchPillText}>{draft.allowResale ? 'Sí' : 'No'}</Text>
              </Pressable>
            </View>)}
          </GlassView>

          <ThemedButton title="Publicar evento" onPress={submit} loading={loading} icon={<Check size={18} color="white" />} />
          <View style={{ height: 28 }} />
        </ScrollView>

        {Platform.OS === 'ios' ? (
          <Modal visible={showIosDateTime} transparent animationType="slide" onRequestClose={() => setShowIosDateTime(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <View style={styles.modalHeaderRow}>
                  <TouchableOpacity onPress={() => setShowIosDateTime(false)}>
                    <Text style={styles.modalActionText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={confirmIosDateTime}>
                    <Text style={styles.modalActionText}>Confirmar</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={iosDateTimeDraft}
                  mode="datetime"
                  display="spinner"
                  onChange={onIosDateTimeChange}
                  minimumDate={minDateTime}
                  themeVariant="dark"
                  textColor={Colors.dark.text as any}
                />
              </View>
            </View>
          </Modal>
        ) : null}

        {Platform.OS === 'ios' ? (
          <Modal visible={showIosEndDateTime} transparent animationType="slide" onRequestClose={() => setShowIosEndDateTime(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <View style={styles.modalHeaderRow}>
                  <TouchableOpacity onPress={() => setShowIosEndDateTime(false)}>
                    <Text style={styles.modalActionText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={confirmIosEndDateTime}>
                    <Text style={styles.modalActionText}>Confirmar</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={iosEndDateTimeDraft}
                  mode="datetime"
                  display="spinner"
                  onChange={onIosEndDateTimeChange}
                  minimumDate={draft.dateTime ?? minDateTime}
                  themeVariant="dark"
                  textColor={Colors.dark.text as any}
                />
              </View>
            </View>
          </Modal>
        ) : null}

        <Modal visible={showMapModal} animationType="slide" onRequestClose={() => setShowMapModal(false)}>
          <View style={[styles.mapModalScreen, { paddingTop: insets.top }]}>
            <View style={styles.mapModalHeader}>
              <TouchableOpacity onPress={() => setShowMapModal(false)} style={styles.mapHeaderIconBtn}>
                <X size={22} color="white" />
              </TouchableOpacity>
              <Text style={styles.mapModalTitle}>Selecciona la ubicación</Text>
              <TouchableOpacity onPress={confirmMapLocation} style={styles.mapHeaderIconBtn}>
                <Check size={22} color="white" />
              </TouchableOpacity>
            </View>

            {/* Search bar inside map modal */}
            <View style={styles.mapSearchContainer}>
              <ThemedInput
                label=""
                placeholder="Buscar dirección…"
                value={mapSearchQuery}
                onChangeText={onMapSearchChange}
                icon={<MapPin size={18} color={Colors.dark.textSecondary} />}
                returnKeyType="search"
                onSubmitEditing={() => { setMapSearchSuggestions([]); Keyboard.dismiss(); }}
                containerStyle={{ marginBottom: 0 }}
              />
              {mapSearchSuggestions.length > 0 && (
                <View style={[styles.suggestionsBox, { position: 'absolute', top: 52, left: 0, right: 0, zIndex: 100 }]}>
                  {mapSearchSuggestions.map((s, i) => (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() => selectMapSuggestion(s)}
                      style={[styles.suggestionItem, i < mapSearchSuggestions.length - 1 && styles.suggestionItemBorder]}
                    >
                      <MapPin size={14} color={Colors.dark.primary} style={{ marginTop: 1 }} />
                      <Text style={styles.suggestionText} numberOfLines={2}>{s.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {mapPickerHtml ? (
              <WebView
                ref={mapWebViewRef}
                source={{ html: mapPickerHtml, baseUrl: 'https://api.maptiler.com' }}
                style={{ flex: 1 }}
                javaScriptEnabled
                domStorageEnabled
                allowUniversalAccessFromFileURLs
                allowsInlineMediaPlayback
                scrollEnabled={false}
                bounces={false}
                overScrollMode="never"
                onMessage={onMapWebViewMessage}
                originWhitelist={['*']}
                mixedContentMode="always"
                androidLayerType="hardware"
              />
            ) : null}

            <View style={[styles.mapBottomCard, { bottom: Math.max(16, insets.bottom + 8) }]}>
              <Text style={styles.mapBottomTitle}>Pulsa en el mapa para marcar el recinto</Text>
              <Text style={styles.mapBottomText}>
                {mapSelection
                  ? `${mapSelection.latitude.toFixed(5)}, ${mapSelection.longitude.toFixed(5)}`
                  : 'Todavía no has marcado ninguna ubicación.'}
              </Text>
              <View style={styles.mapBottomActions}>
                <ThemedButton
                  title={isResolvingAddress ? 'Buscando dirección...' : 'Usar punto'}
                  onPress={confirmMapLocation}
                  disabled={!mapSelection || isResolvingAddress}
                  icon={<Navigation size={18} color="white" />}
                />
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 24, paddingBottom: 12, gap: 14 },
  backButton: { marginTop: 2 },
  backButtonContainer: { padding: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.10)' },
  headerTitle: { color: Colors.dark.text, fontSize: 24, fontWeight: '900' },
  headerSubtitle: { color: Colors.dark.textSecondary, marginTop: 4, lineHeight: 18 },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  card: { padding: 18, borderRadius: 20, marginBottom: 16 },
  cardBorder: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  sectionTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '900', marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  fieldLabel: { color: Colors.dark.textSecondary, fontSize: 13, marginBottom: 10, marginTop: 4 },
  helperText: { color: Colors.dark.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipActive: { borderColor: 'rgba(124,58,237,0.55)', backgroundColor: 'rgba(124,58,237,0.28)' },
  chipText: { color: Colors.dark.textSecondary, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  imageGrid: { flexDirection: 'row', gap: 12 },
  imageCol: { flex: 1 },
  imageSelector: {
    height: 160,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  imageSelectorError: { borderColor: Colors.dark.error },
  imagePreview: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  imagePlaceholderText: { color: Colors.dark.textSecondary, textAlign: 'center', marginTop: 8, fontWeight: '700' },
  conditionalCard: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  conditionalTitle: { color: Colors.dark.text, fontSize: 14, fontWeight: '900', marginBottom: 10 },
  toggleRow: {
    marginBottom: 14,
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: { color: Colors.dark.text, fontSize: 14, fontWeight: '800' },
  switchPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  switchPillOn: {
    borderColor: 'rgba(34,197,94,0.55)',
    backgroundColor: 'rgba(34,197,94,0.18)',
  },
  switchPillText: { color: Colors.dark.text, fontSize: 13, fontWeight: '900' },
  ticketList: { marginTop: 14, gap: 10 },
  ticketCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  ticketTitle: { color: Colors.dark.text, fontWeight: '900', fontSize: 14, marginBottom: 4 },
  ticketMeta: { color: Colors.dark.textSecondary, fontSize: 13 },
  deleteButton: { padding: 8 },
  metricsCard: {
    marginTop: 14,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
    backgroundColor: 'rgba(124,58,237,0.08)',
  },
  metricsTitle: { color: Colors.dark.text, fontWeight: '900', marginBottom: 6 },
  metricsText: { color: Colors.dark.textSecondary, lineHeight: 18 },
  errorText: { color: Colors.dark.error, fontSize: 12, marginTop: 8 },
  smallButton: { width: 124, minHeight: 42 },
  bottleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4 },
  bottleQty: { width: 72 },
  bottleRemoveBtn: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  addBottleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.dark.primary + '60', backgroundColor: Colors.dark.primary + '12', alignSelf: 'flex-start', marginTop: 4 },
  addBottleTxt: { color: Colors.dark.primary, fontWeight: '800', fontSize: 13 },

  locationPreview: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(34,197,94,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  locationPreviewText: { color: '#86efac', fontWeight: '700', flex: 1, fontSize: 13 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  modalCard: {
    backgroundColor: '#1e1b4b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  modalActionText: { color: Colors.dark.primary, fontSize: 16, fontWeight: '900' },
  mapModalScreen: { flex: 1, backgroundColor: Colors.dark.background },
  mapModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#111126',
  },
  mapHeaderIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  mapModalTitle: { color: 'white', fontSize: 16, fontWeight: '900' },
  mapBottomCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 18,
    padding: 16,
    backgroundColor: 'rgba(11,11,20,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  mapBottomTitle: { color: 'white', fontWeight: '900', marginBottom: 6 },
  mapBottomText: { color: Colors.dark.textSecondary, marginBottom: 12 },
  mapBottomActions: { marginTop: 2 },
  suggestionsBox: {
    backgroundColor: '#13132a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginTop: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  suggestionText: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 13,
    lineHeight: 18,
  },
  mapSearchContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111126',
    zIndex: 10,
  },
});

