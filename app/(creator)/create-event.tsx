import { SalesOfferForm } from '@/components/SalesOfferForm';
import { LAUNCH_FEATURES } from '@/lib/launchFeatures';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { FormDateTimeField } from '@/components/ui/FormDateTimeField';
import { theme } from '@/theme/styles';
import { EVENT_FORM_STEPS, eventStepForField, getEventDraftErrors, type EventDraft } from '@/lib/createEventForm';
import WebView from 'react-native-webview';
import {
  buildTicketName,
  prepareOfferForCatalog,
  hasPendingOffer,
  getCatalogSummary,
  offerFromRow,
  OFFER_CATEGORIES,
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
  Camera,
  Check,
  Image as ImageIcon,
  Lock,
  MapPin,
  Navigation,
  Sparkles,
  Tag,
  Ticket,
  Trash2,
  X,
} from '@/lib/icons';


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
  const [formStep, setFormStep] = useState(0);
  const [offerAttempted, setOfferAttempted] = useState(false);
  const [offerEditorOpen, setOfferEditorOpen] = useState(true);
  const [formNotice, setFormNotice] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const catalogSummary = useMemo(() => getCatalogSummary(ticketTypes), [ticketTypes]);
  const navigateStep = (step: number) => { Keyboard.dismiss(); setFormStep(step); setFormNotice(''); scrollRef.current?.scrollTo({ y: 0, animated: false }); };

  const [submitAttempted, setSubmitAttempted] = useState(false);

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
          .select('*, venues(*), event_ticket_types(*), reservados_vip(*)')
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
        setOfferEditorOpen(false);
        setTicketTypes([
          ...(data.event_ticket_types || []).filter((t:any)=>!t.deleted_at && t.is_active!==false && t.category!=='vip').map((t:any)=>offerFromRow(t)),
          ...(data.reservados_vip || []).filter((t:any)=>!t.deleted_at && t.is_active!==false).map((t:any)=>offerFromRow(t,true)),
        ]);
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

  const newTicketErrors = useMemo(() => getTicketDraftErrors(newTicket), [newTicket]);

  const errors = useMemo(() => getEventDraftErrors(draft, isEditing, minDateTime, ticketTypes.length), [draft, isEditing, minDateTime, ticketTypes.length]);

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
    setDraft(prev => ({ ...prev, location: '', coordinates: null }));
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

  const addTicketType = useCallback(() => {
    setOfferAttempted(true);
    const prepared = prepareOfferForCatalog(newTicket);
    if (!prepared) return;
    const entry = { ...prepared, id: prepared.id === 'draft' ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : prepared.id };
    setTicketTypes(prev => [...prev.filter(ticket => ticket.id !== entry.id), entry]);
    setNewTicket(createEmptyTicketDraft());
    setOfferAttempted(false);
    setOfferEditorOpen(false);
    setFormNotice('Oferta guardada en el formulario. Se publicará al guardar el evento.');
  }, [newTicket]);

  const continueForm = () => {
    setSubmitAttempted(true);
    if (formStep === 2 && offerEditorOpen && hasPendingOffer(newTicket)) {
      setOfferAttempted(true);
      setFormNotice('Añade o guarda la oferta que estás editando antes de continuar.');
      return;
    }
    const currentErrors = Object.keys(errors).filter(key => eventStepForField(key) <= formStep);
    if (currentErrors.length) { setFormStep(eventStepForField(currentErrors[0])); setFormNotice('Revisa los campos señalados para continuar.'); scrollRef.current?.scrollTo({y: 0, animated: true}); return; }
    setSubmitAttempted(false);
    navigateStep(formStep + 1);
  };

  const removeTicketType = useCallback((id: string) => {
    setTicketTypes((prev) => prev.filter((ticket) => ticket.id !== id));
  }, []);

  const submit = useCallback(async () => {
    setSubmitAttempted(true);
    if (offerEditorOpen && hasPendingOffer(newTicket)) {
      setFormStep(2);
      setOfferAttempted(true);
      Alert.alert('Oferta pendiente', 'Añade o guarda la oferta que estás editando antes de publicar el evento.');
      return;
    }
    if (Object.keys(errors).length > 0) {
      setFormStep(eventStepForField(Object.keys(errors)[0]));
      setFormNotice('Revisa los campos señalados antes de publicar.');
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
      const mappedTicketTypes = ticketTypes.filter(t=>t.category!=='vip_table').map((ticket) => ({
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
        vipTables: ticketTypes.filter(t=>t.category==='vip_table').map(t=>({
          id:t.id,name:buildTicketName(t),description:t.benefits,base_price:parsePositiveNumber(t.price),
          quantity_available:Number(t.quantity),capacity_people:Number(t.vipGroupSize),
          included_bottles:t.vipFreeBottles.reduce((n,b)=>n+Number(b.quantity),0),
          extra_bottle_price:t.extraBottlePrice?parsePositiveNumber(t.extraBottlePrice):null,
          expected_available:t.originalMetadata?.catalogAvailable,
          metadata:serializeTicketMetadata(t),
        })),
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
  }, [addEvent, updateEvent, isEditing, eventId, draft, errors, metrics.capacity, metrics.minPrice, safeBack, ticketTypes, newTicket, offerEditorOpen, user?.id]);

  return (
    <View style={styles.container}>
      <LinearGradient colors={Colors.dark.backgroundGradient} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <GlassView contentContainerStyle={{padding: 0}} intensity={20} style={styles.backButtonContainer}>
              <ArrowLeft size={24} color={Colors.dark.text} />
            </GlassView>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{isEditing ? 'Editar evento' : 'Crear evento'}</Text>
            <Text style={styles.headerSubtitle}>{isEditing ? 'Revisa tus cambios antes de guardarlos.' : 'Prepara tu evento y revisa cómo se venderá.'}</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.stepsRow}>{EVENT_FORM_STEPS.map((label, index) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Paso ${index + 1}: ${label}`} accessibilityState={{ selected: formStep === index, disabled: index > formStep }} disabled={index > formStep} onPress={() => navigateStep(index)} style={styles.stepItem}><View style={[styles.stepLine, index <= formStep && styles.stepLineActive]}/><Text style={[styles.stepText, index === formStep && styles.stepTextActive]}>{index + 1}. {label}</Text></Pressable>)}</View>
          <Text style={styles.helperText}>Los campos con * son obligatorios. Tus cambios se publican al confirmar el último paso.</Text>
          {!!formNotice && <Text accessibilityRole="alert" style={styles.formNotice}>{formNotice}</Text>}
          {formStep === 0 && <>

          <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Información básica</Text>
            <ThemedInput
              label="Nombre del evento *"
              hint="Así aparecerá en la app y en las entradas."
              placeholder="Nombre del evento"
              value={draft.title}
              onChangeText={(value) => updateDraft('title', value)}
              error={getError('title')}
              icon={<Tag size={20} color={Colors.dark.textSecondary} />}
              maxLength={100}
            />
            <ThemedInput
              label="Descripción *"
              hint="Cuenta qué ocurrirá: ambiente, artistas y lo que incluye la experiencia."
              placeholder="Describe el evento"
              value={draft.description}
              onChangeText={(value) => updateDraft('description', value)}
              error={getError('description')}
              multiline
              numberOfLines={4}
              maxLength={2000}
              inputStyle={{ minHeight: 120, textAlignVertical: 'top' }}
            />
            <Text style={styles.fieldLabel}>Tipo de evento *</Text>
            <View style={styles.chipsRow}>
              {eventTypeOptions.map(({ key, label, Icon }) => {
                const selected = draft.eventType === key;
                return (
                  <Pressable key={key} accessibilityRole="radio" accessibilityState={{checked:selected}} onPress={() => updateDraft('eventType', key)} style={[styles.chip, selected ? styles.chipActive : null]}>
                    <Icon size={16} color={selected ? '#fff' : Colors.dark.textSecondary} />
                    <Text style={[styles.chipText, selected ? styles.chipTextActive : null]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </GlassView>

          <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Imágenes</Text>
            <View style={styles.imageGrid}>
              <View style={styles.imageCol}>
                <Text style={styles.fieldLabel}>Cartel del evento *</Text>
                <TouchableOpacity onPress={() => chooseImageSource('imageUri')} activeOpacity={0.85}>
                  <GlassView contentContainerStyle={{padding: 0, flex: 1}} intensity={10} style={[styles.imageSelector, getError('imageUri') ? styles.imageSelectorError : null]}>
                    {draft.imageUri ? (
                      <Image source={{ uri: draft.imageUri }} style={styles.imagePreview} resizeMode="cover" />
                    ) : (
                      <View style={styles.imagePlaceholder}>
                        <Camera size={26} color={Colors.dark.textSecondary} />
                        <Text style={styles.imagePlaceholderText}>Añadir cartel</Text>
                      </View>
                    )}
                  </GlassView>
                </TouchableOpacity>
                {getError('imageUri') ? <Text style={styles.errorText}>{getError('imageUri')}</Text> : null}
              </View>

              <View style={styles.imageCol}>
                <Text style={styles.fieldLabel}>Plano (opcional)</Text>
                <TouchableOpacity onPress={() => chooseImageSource('venuePlanUri')} activeOpacity={0.85}>
                  <GlassView contentContainerStyle={{padding: 0, flex: 1}} intensity={10} style={styles.imageSelector}>
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

          <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Detalles del evento</Text>
            <ThemedInput
              label="Música / temática (opcional)"
              placeholder="Ej: Tech house"
              value={draft.theme}
              onChangeText={(value) => updateDraft('theme', value)}
              icon={<Sparkles size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Código de vestimenta (opcional)"
              hint="Si existe una norma de vestimenta, explícalo aquí."
              placeholder="Ej: Total black"
              value={draft.dressCode}
              onChangeText={(value) => updateDraft('dressCode', value)}
              icon={<Tag size={20} color={Colors.dark.textSecondary} />}
            />
            <ThemedInput
              label="Edad mínima *"
              hint="Edad exigida para acceder al evento."
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

          </>}
          {formStep === 1 && <>
          <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Fecha y hora</Text>
            <FormDateTimeField label="Inicio del evento *" value={draft.dateTime?.toISOString()} onChange={value => updateDraft('dateTime', value ? new Date(value) : null)} error={getError('dateTime')} minimumDate={isEditing ? undefined : minDateTime} hint="Fecha y hora de apertura general. Se usarán para calcular los accesos anticipados y los límites de llegada."/>
            <FormDateTimeField label="Fin del evento *" value={draft.endDateTime?.toISOString()} onChange={value => updateDraft('endDateTime', value ? new Date(value) : null)} error={getError('endDateTime')} minimumDate={draft.dateTime || minDateTime} base={new Date((draft.dateTime || minDateTime).getTime() + 4 * 60 * 60 * 1000)} hint="Si la fiesta termina de madrugada, selecciona el día siguiente. Debe ser posterior al inicio."/>
            <Text style={styles.helperText}>Los horarios se muestran en la hora local de tu dispositivo.</Text>
          </GlassView>

          <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
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
                label="Dirección del evento *"
                hint="Elige un resultado de búsqueda o marca el punto en el mapa. Escribir una dirección no fija su ubicación."
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


          </>}
          {formStep === 2 && <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
            <Text style={styles.sectionTitle}>Entradas y mesas</Text>
            <Text style={styles.helperText}>Añade las opciones que podrá elegir tu cliente. Cada oferta tiene su precio, cupo y condiciones. VIP corresponde siempre a una mesa reservada.</Text>
            {getError('ticketTypes') && <Text accessibilityRole="alert" style={styles.errorText}>{getError('ticketTypes')}</Text>}
            <View style={styles.ticketList}>{ticketTypes.map(ticket => <View key={ticket.id} style={styles.ticketCard}>
              <View style={{flex: 1, minWidth: 0}}><Text style={styles.ticketTitle}>{buildTicketName(ticket)}</Text><Text style={styles.ticketMeta}>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(ticket.price))} / {ticket.category === 'vip_table' ? 'mesa' : ticket.category === 'group' ? 'pack' : 'persona'}</Text><Text style={styles.ticketMeta}>{ticket.category === 'vip_table' ? ticket.quantity + ' mesas disponibles · hasta ' + ticket.vipGroupSize + ' personas por mesa' : ticket.category === 'group' ? ticket.quantity + ' packs en total · ' + ticket.admissionsPerUnit + ' personas por pack · sin mesa' : ticket.quantity + ' entradas en total'}</Text></View>
              <View><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Editar ${ticket.name}`} disabled={offerEditorOpen && hasPendingOffer(newTicket)} onPress={() => {setNewTicket({...ticket}); setOfferAttempted(false); setOfferEditorOpen(true); setFormNotice('');}} style={styles.deleteButton}><Text style={{color: Colors.dark.secondary}}>Editar</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Quitar ${ticket.name} del catálogo`} disabled={offerEditorOpen && hasPendingOffer(newTicket)} onPress={() => removeTicketType(ticket.id)} style={styles.deleteButton}><Trash2 size={18} color={Colors.dark.error}/></TouchableOpacity></View>
            </View>)}</View>
            {offerEditorOpen ? <View style={styles.offerEditor}><SalesOfferForm value={newTicket} onChange={setNewTicket} errors={newTicketErrors} showErrors={offerAttempted} onAdd={addTicketType} onCancel={() => {setNewTicket(createEmptyTicketDraft()); setOfferAttempted(false); setOfferEditorOpen(false); setFormNotice('');}} eventDate={draft.dateTime}/></View> : <ThemedButton title="Añadir entrada o mesa" variant="outline" onPress={() => {setNewTicket(createEmptyTicketDraft()); setOfferAttempted(false); setOfferEditorOpen(true);}} style={{marginTop: 20}}/>}
            <View style={styles.metricsCard}><Text style={styles.metricsTitle}>Disponibilidad del catálogo</Text><Text style={styles.metricsText}>{catalogSummary.tickets} entradas · {catalogSummary.packs} packs · {catalogSummary.tables} mesas</Text><Text style={styles.metricsText}>Hasta {catalogSummary.people} personas con las unidades disponibles.</Text></View>
          </GlassView>}
          {formStep === 3 && <>
            <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
              <Text style={styles.sectionTitle}>Revisa tu evento</Text>
              <Text style={styles.helperText}>{isEditing ? 'Estos cambios se guardarán en tu evento.' : 'Esto es lo que publicarás para tus clientes.'}</Text>
              {!!draft.imageUri && <Image source={{uri:draft.imageUri}} style={styles.reviewPoster} resizeMode="cover"/>}
              <Text style={styles.reviewTitle}>{draft.title}</Text><Text style={styles.reviewText}>{draft.description}</Text>
              <Text style={styles.reviewLabel}>Fecha y lugar</Text><Text style={styles.reviewText}>{draft.dateTime?.toLocaleString('es-ES')} → {draft.endDateTime?.toLocaleString('es-ES')}</Text><Text style={styles.reviewText}>{draft.location}</Text>
              <Text style={styles.reviewLabel}>Condiciones de acceso</Text><Text style={styles.reviewText}>Edad mínima: {draft.ageRestriction} años{draft.dressCode ? ' · Vestimenta: ' + draft.dressCode : ''}{draft.theme ? '\nMúsica / temática: ' + draft.theme : ''}</Text>
              <ThemedButton title="Editar información" variant="outline" onPress={() => navigateStep(0)} style={{marginTop:16}}/>
            </GlassView>
            <GlassView contentContainerStyle={{padding: 0}} intensity={14} style={[styles.card, styles.cardBorder]}>
              <Text style={styles.sectionTitle}>Lo que podrá comprar el cliente</Text>
              {ticketTypes.map(ticket => <View key={ticket.id} style={styles.reviewOffer}><Text style={styles.ticketTitle}>{ticket.name}</Text><Text style={styles.reviewText}>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(ticket.price))} / {ticket.category === 'vip_table' ? 'mesa completa' : ticket.category === 'group' ? 'pack de ' + ticket.admissionsPerUnit + ' personas' : 'persona'}</Text><Text style={styles.ticketMeta}>{ticket.category === 'vip_table' ? 'Mesa reservada para hasta ' + ticket.vipGroupSize + ' personas' : ticket.category === 'group' ? 'Acceso conjunto · Sin mesa reservada' : OFFER_CATEGORIES.find(c => c.key === ticket.category)?.label}</Text>{!!ticket.benefits && <Text style={styles.ticketMeta}>{ticket.benefits}</Text>}{!!ticket.salesStartAt && <Text style={styles.ticketMeta}>Venta desde {new Date(ticket.salesStartAt).toLocaleString('es-ES')}</Text>}{!!ticket.salesEndAt && <Text style={styles.ticketMeta}>Venta hasta {new Date(ticket.salesEndAt).toLocaleString('es-ES')}</Text>}</View>)}
              <Text style={styles.helperText}>Precios base. Los gastos de gestión se desglosan durante la compra.</Text>
              <ThemedButton title="Editar entradas y mesas" variant="outline" onPress={() => navigateStep(2)}/>
            </GlassView>
          </>}

          <View style={styles.formActions}>{formStep > 0 && <ThemedButton title="Anterior" variant="outline" disabled={loading} onPress={() => navigateStep(formStep - 1)} style={{flex:1}}/>}{formStep < 3 ? <ThemedButton title="Continuar" onPress={continueForm} style={{flex:2}}/> : <ThemedButton title={isEditing ? 'Guardar cambios' : 'Publicar evento'} onPress={submit} loading={loading} icon={<Check size={18} color="white"/>} style={{flex:2}}/>}</View>
          <View style={{ height: 28 }} />
        </ScrollView>
        </KeyboardAvoidingView>

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
  content: { paddingHorizontal: 16, paddingBottom: 40, width: '100%', maxWidth: 680, alignSelf: 'center' },
  card: { padding: 20, borderRadius: theme.radius.lg, marginBottom: 16 },
  cardBorder: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  sectionTitle: { color: Colors.dark.text, fontSize: 18, fontWeight: '900', marginBottom: 12 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  fieldLabel: { color: Colors.dark.text, fontSize: 16, fontWeight: '600', marginBottom: 10, marginTop: 4 },
  stepsRow: {flexDirection: 'row', gap: 8, marginBottom: 20},
  stepItem: {flex:1}, stepLine: {height:3, borderRadius:3, backgroundColor:Colors.dark.border, marginBottom:8}, stepLineActive: {backgroundColor:Colors.dark.primary},
  stepText: {color:Colors.dark.textSecondary,fontSize:12,lineHeight:18}, stepTextActive:{color:Colors.dark.text,fontWeight:'700'},
  formNotice: {color:Colors.dark.secondary, backgroundColor:Colors.dark.primarySoft, borderRadius:14, padding:14, marginBottom:16, fontSize:14, lineHeight:21},
  formActions: {flexDirection:'row',gap:12}, offerEditor:{marginTop:24,paddingTop:24,borderTopWidth:1,borderTopColor:Colors.dark.border},
  reviewPoster:{width:'100%',height:180,borderRadius:14,marginBottom:20}, reviewTitle:{fontSize:24,fontWeight:'900',color:Colors.dark.text,marginBottom:8},
  reviewLabel:{fontSize:14,fontWeight:'700',color:Colors.dark.text,marginTop:20,marginBottom:8}, reviewText:{fontSize:14,lineHeight:21,color:Colors.dark.textSecondary}, reviewOffer:{paddingVertical:16,borderTopWidth:1,borderTopColor:Colors.dark.border,gap:4},
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
  deleteButton: { padding: 10, minHeight: 44, justifyContent: 'center' },
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
