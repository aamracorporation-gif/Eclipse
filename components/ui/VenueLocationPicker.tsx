import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { buildLocationPickerHtml } from '@/lib/locationPickerHtml';
import { findVenueLocations, VenueLocation } from '@/lib/venueGeocoding';

type Props = { initialAddress: string; onClose: () => void; onSelect: (location: VenueLocation) => void };

// Mounted only while open, so closing aborts outstanding geocoding requests.
export function VenueLocationPicker({ initialAddress, onClose, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const request = useRef<AbortController | null>(null);
  const [query, setQuery] = useState(initialAddress);
  const [results, setResults] = useState<VenueLocation[]>([]);
  const [selected, setSelected] = useState<VenueLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState(false);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const html = useMemo(() => buildLocationPickerHtml(37.3891, -5.9845, null), []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setMapError(true), 15000);
    return () => clearTimeout(timer);
  }, [ready, revision]);
  useEffect(() => {
    if (ready && selected) web.current?.injectJavaScript(`window.setPickerPin(${selected.latitude},${selected.longitude},true);true;`);
  }, [ready, selected]);

  async function lookup(text: string, point?: { latitude: number; longitude: number }) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setResults([]); setSelected(null);
    const timeout = setTimeout(() => {
      controller.abort();
      if (request.current === controller) { setBusy(false); setError('La búsqueda ha tardado demasiado. Vuelve a intentarlo.'); }
    }, 12000);
    try {
      const locations = await findVenueLocations(text, controller.signal);
      if (controller.signal.aborted) return;
      if (!locations.length) { setError('No se encontró una calle. Busca otra dirección o completa el formulario manualmente.'); return; }
      if (point) setSelected({ ...locations[0], ...point });
      else setResults(locations);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'No se pudo buscar la dirección.');
    } finally {
      clearTimeout(timeout);
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        <TouchableOpacity onPress={onClose} accessibilityRole="button"><Text style={styles.action}>Cancelar</Text></TouchableOpacity>
        <Text style={styles.heading}>Ubicación del local</Text>
      </View>
      <View style={styles.row}>
        <TextInput style={styles.input} placeholder="Busca calle, número y ciudad" placeholderTextColor="#aaa" value={query}
          onChangeText={text => { request.current?.abort(); setBusy(false); setQuery(text); setResults([]); setSelected(null); }}
          returnKeyType="search" onSubmitEditing={() => { Keyboard.dismiss(); void lookup(query); }} />
        <TouchableOpacity disabled={query.trim().length < 3 || busy} onPress={() => { Keyboard.dismiss(); void lookup(query); }} accessibilityRole="button"><Text style={styles.action}>Buscar</Text></TouchableOpacity>
      </View>
      {busy && <ActivityIndicator color="#A78BFA" />}
      {!!error && <Text accessibilityRole="alert" style={styles.notice}>{error}</Text>}
      {results.length > 0 && <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {results.map((location, index) => <TouchableOpacity key={`${location.latitude}:${location.longitude}:${index}`} style={styles.result}
          onPress={() => { setSelected(location); setResults([]); Keyboard.dismiss(); }}>
          <Text style={styles.text}>{location.address}</Text>
        </TouchableOpacity>)}
      </ScrollView>}
      <WebView key={revision} ref={web} style={styles.map} source={{ html, baseUrl: 'https://api.maptiler.com' }}
        originWhitelist={['*']} javaScriptEnabled domStorageEnabled androidLayerType="hardware"
        onError={() => setMapError(true)} onHttpError={() => setMapError(true)}
        onMessage={event => {
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg.type === 'ready') { setReady(true); setMapError(false); }
            if (msg.type === 'mapError') setMapError(true);
            if (msg.type === 'pinDrop' && Number.isFinite(msg.lat) && Number.isFinite(msg.lng) && Math.abs(msg.lat) <= 90 && Math.abs(msg.lng) <= 180) {
              void lookup(`${msg.lng},${msg.lat}`, { latitude: msg.lat, longitude: msg.lng });
            }
          } catch { /* Ignore unrelated WebView messages. */ }
        }} />
      {mapError && <View style={styles.row}><Text style={[styles.notice, { flex: 1 }]}>No se pudo cargar el mapa. Puedes buscar una calle o escribirla manualmente.</Text>
        <TouchableOpacity onPress={() => { setReady(false); setMapError(false); setRevision(value => value + 1); }}><Text style={styles.action}>Reintentar</Text></TouchableOpacity></View>}
      <View style={styles.footer}>
        <Text style={styles.text}>{selected?.address || 'Busca una calle o pulsa el punto exacto en el mapa.'}</Text>
        <Text style={styles.hint}>Revisa el número, la ciudad y el código postal al volver al formulario.</Text>
        <TouchableOpacity accessibilityRole="button" disabled={!selected || busy} style={[styles.confirm, (!selected || busy) && { opacity: 0.4 }]}
          onPress={() => { if (selected) onSelect(selected); }}><Text style={styles.heading}>Usar esta dirección</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1117' }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  heading: { color: 'white', fontSize: 16, fontWeight: '700' }, action: { color: '#C4B5FD', padding: 8 },
  input: { flex: 1, color: 'white', backgroundColor: '#202330', padding: 12, borderRadius: 10 },
  map: { flex: 1 }, results: { maxHeight: 190 }, result: { padding: 14, borderBottomWidth: 1, borderBottomColor: '#333' },
  text: { color: 'white' }, notice: { color: '#FBBF24', padding: 10 }, hint: { color: '#bbb', fontSize: 12, marginVertical: 8 },
  footer: { padding: 16 }, confirm: { backgroundColor: '#6D28D9', padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 8 },
});
