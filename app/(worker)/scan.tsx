import { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Modal, Alert,
  Vibration, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Check, ChevronDown, X, Keyboard as KeyboardIcon, Users } from '@/lib/icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useResponsive } from '@/lib/responsive';

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function WorkerScanScreen() {
  const { workerProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth, scaleFont, width } = useResponsive();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const isScanning = useRef(false);

  // ── NEW: session counter & event capacity ──────────────────────────
  const [sessionScans, setSessionScans] = useState(0);
  const [eventAccessCount, setEventAccessCount] = useState<number | null>(null);

  // ── NEW: manual entry ─────────────────────────────────────────────
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(worker)');
  };

  const fetchEventsAndSelectNearest = useCallback(async () => {
    if (!workerProfile) return;
    try {
      let userLoc = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          userLoc = { lat: loc.coords.latitude, lon: loc.coords.longitude };
        }
      } catch {
        console.warn('No se pudo obtener la ubicación para el escaneo.');
      }

      // Include events from the last 12 hours so overnight parties still show up
      const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data: assignmentsData, error } = await supabase
        .from('worker_event_assignments')
        .select('events!inner(id, title, event_date, venues(latitude, longitude))')
        .eq('worker_id', workerProfile.id)
        .eq('status', 'active')
        .gte('events.event_date', cutoff);

      if (error) throw error;

      const data = (assignmentsData || [])
        .map((r: any) => r.events)
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.event_date).localeCompare(String(b.event_date)));

      if (data && data.length > 0) {
        setEvents(data);
        const todayStr = new Date().toISOString().split('T')[0];
        const todayEvents = data.filter(e => e.event_date.startsWith(todayStr));

        if (todayEvents.length > 0) {
          if (userLoc && todayEvents.length > 1) {
            const sortedByDist = [...todayEvents].sort((a, b) => {
              const vA: any = a.venues;
              const vB: any = b.venues;
              const distA = vA?.latitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vA.latitude, vA.longitude) : 99999;
              const distB = vB?.latitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vB.latitude, vB.longitude) : 99999;
              return distA - distB;
            });
            setSelectedEventId(sortedByDist[0].id);
          } else {
            setSelectedEventId(todayEvents[0].id);
          }
        } else if (userLoc) {
          const sortedByDist = [...data].sort((a, b) => {
            const vA: any = a.venues;
            const vB: any = b.venues;
            const distA = vA?.latitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vA.latitude, vA.longitude) : 99999;
            const distB = vB?.latitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vB.latitude, vB.longitude) : 99999;
            return distA - distB;
          });
          setSelectedEventId(sortedByDist[0].id);
        } else {
          setSelectedEventId(data[0].id);
        }
      }
    } catch (e) {
      console.error('Error fetching events for scanner:', e);
    }
  }, [workerProfile]);

  // ── Fetch how many people have already entered for the selected event ──
  const fetchEventAccessCount = useCallback(async (eventId: string) => {
    try {
      const { count } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('status', 'used');
      setEventAccessCount(count ?? 0);
    } catch {
      setEventAccessCount(null);
    }
  }, []);

  useEffect(() => {
    if (!permission?.granted) requestPermission();
    fetchEventsAndSelectNearest();
  }, [fetchEventsAndSelectNearest, permission?.granted, requestPermission]);

  useEffect(() => {
    if (selectedEventId) {
      fetchEventAccessCount(selectedEventId);
    } else {
      setEventAccessCount(null);
    }
  }, [selectedEventId, fetchEventAccessCount]);

  const playFeedback = async (success: boolean) => {
    try {
      if (success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      Vibration.vibrate(success ? 100 : 500);
    }
  };

  // Core validation logic — shared between QR scan and manual entry
  const validateCode = async (code: string): Promise<any> => {
    if (!workerProfile?.id) throw new Error('Perfil de trabajador no encontrado');
    const { data: validationData, error } = await supabase.rpc('validate_ticket_worker_v2', {
      p_qr_token: code,
      p_worker_id: workerProfile.id,
      p_event_id: selectedEventId,
    });
    if (error) throw error;
    if (validationData.valid && validationData.event_id && validationData.event_id !== selectedEventId) {
      return { valid: false, message: 'ENTRADA DE OTRO EVENTO', attendee_name: validationData.attendee_name, ticket_type: validationData.ticket_type };
    }
    return validationData;
  };

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (scanned || loading || isScanning.current) return;
    if (!selectedEventId) {
      Alert.alert('Atención', 'Por favor selecciona un evento antes de escanear.');
      return;
    }

    isScanning.current = true;
    setScanned(true);
    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const validationData = await validateCode(data.trim());
      setResult(validationData);
      await playFeedback(validationData.valid);
      if (validationData.valid) {
        setSessionScans(prev => prev + 1);
        // Update live access count
        setEventAccessCount(prev => (prev !== null ? prev + 1 : 1));
      }
      setModalVisible(true);
    } catch (error: any) {
      console.error('[WorkerScanner] Validation Error:', error);
      Alert.alert('Error', 'Error al validar el código: ' + error.message, [{
        text: 'OK',
        onPress: () => { setScanned(false); isScanning.current = false; },
      }]);
    } finally {
      setLoading(false);
    }
  };

  // ── Manual entry handler ──────────────────────────────────────────
  const handleManualValidate = async () => {
    const code = manualCode.trim();
    if (!code) {
      Alert.alert('Atención', 'Introduce el código de la entrada.');
      return;
    }
    if (!selectedEventId) {
      Alert.alert('Atención', 'Por favor selecciona un evento primero.');
      return;
    }
    if (manualLoading) return;

    setManualLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const validationData = await validateCode(code);
      setResult(validationData);
      await playFeedback(validationData.valid);
      if (validationData.valid) {
        setSessionScans(prev => prev + 1);
        setEventAccessCount(prev => (prev !== null ? prev + 1 : 1));
      }
      setManualCode('');
      setShowManualEntry(false);
      setModalVisible(true);
    } catch (error: any) {
      Alert.alert('Error', 'Error al validar: ' + error.message);
    } finally {
      setManualLoading(false);
    }
  };

  const closeModal = () => {
    setModalVisible(false);
    setResult(null);
    setScanned(false);
    isScanning.current = false;
  };

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={{ textAlign: 'center', color: 'white', marginBottom: 20 }}>
          Necesitamos permiso para usar la cámara
        </Text>
        <ThemedButton onPress={requestPermission} title="Dar permiso" />
      </View>
    );
  }

  const selectedEvent = events.find(e => e.id === selectedEventId);

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned || showManualEntry ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />

      {/* Overlay UI */}
      <View style={[styles.overlay, { paddingTop: insets.top + 20, paddingHorizontal: horizontalPadding }]}>
        <View style={{ flex: 1, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }}>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.closeButton} onPress={safeBack}>
              <X size={28} color="white" />
            </TouchableOpacity>
            <Text style={[styles.title, { fontSize: scaleFont(18) }]}>Escanear Entrada</Text>
            {/* Session scan counter */}
            <View style={styles.sessionCounterBadge}>
              <Text style={styles.sessionCounterText}>✅ {sessionScans}</Text>
            </View>
          </View>

          {/* Event selector */}
          <View style={styles.eventSelectorContainer}>
            <Text style={[styles.selectorLabel, { fontSize: scaleFont(12) }]}>Evento seleccionado:</Text>
            <TouchableOpacity
              style={styles.eventSelector}
              onPress={() => setShowEventSelector(!showEventSelector)}
              activeOpacity={0.85}
            >
              <Text style={[styles.selectedEventText, { fontSize: scaleFont(16) }]} numberOfLines={1}>
                {selectedEvent?.title || 'Seleccionar evento...'}
              </Text>
              <ChevronDown size={20} color="white" />
            </TouchableOpacity>

            {showEventSelector && events.length > 0 && (
              <View style={styles.dropdownList}>
                {events.map(event => (
                  <TouchableOpacity
                    key={event.id}
                    style={[styles.dropdownItem, selectedEventId === event.id && styles.activeDropdownItem]}
                    onPress={() => { setSelectedEventId(event.id); setShowEventSelector(false); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.dropdownText, { fontSize: scaleFont(16) }, selectedEventId === event.id && styles.activeDropdownText]} numberOfLines={1}>
                      {event.title}
                    </Text>
                    <Text style={[styles.dropdownDate, { fontSize: scaleFont(12) }]} numberOfLines={1}>
                      {new Date(event.event_date).toLocaleDateString()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Scan frame or manual entry */}
          {showManualEntry ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.manualEntryContainer}
            >
              <GlassView intensity={35} style={styles.manualEntryCard}>
                <Text style={styles.manualEntryTitle}>Entrada manual</Text>
                <Text style={styles.manualEntrySubtitle}>
                  Introduce el código corto de la entrada (ej. ECL-A3F9)
                </Text>
                <TextInput
                  style={styles.manualInput}
                  value={manualCode}
                  onChangeText={(t) => setManualCode(t.toUpperCase())}
                  placeholder="ECL-XXXX"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleManualValidate}
                />
                <View style={styles.manualActions}>
                  <TouchableOpacity
                    style={styles.manualCancelBtn}
                    onPress={() => { setShowManualEntry(false); setManualCode(''); }}
                  >
                    <Text style={styles.manualCancelText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.manualValidateBtn, manualLoading && { opacity: 0.6 }]}
                    onPress={handleManualValidate}
                    disabled={manualLoading}
                  >
                    {manualLoading
                      ? <DiscoLoader size={22} />
                      : <Text style={styles.manualValidateText}>Validar</Text>}
                  </TouchableOpacity>
                </View>
              </GlassView>
            </KeyboardAvoidingView>
          ) : (
            <View style={styles.scanFrameContainer}>
              <View
                style={[
                  styles.scanFrame,
                  {
                    width: Math.min(280, Math.max(220, width - horizontalPadding * 2 - 40)),
                    height: Math.min(280, Math.max(220, width - horizontalPadding * 2 - 40)),
                  },
                ]}
              />
              {/* Access count badge below scan frame */}
              {eventAccessCount !== null && (
                <View style={styles.accessCountBadge}>
                  <Users size={14} color="#a3e635" />
                  <Text style={styles.accessCountText}>
                    {eventAccessCount} accedido{eventAccessCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}
              <Text style={[styles.scanInstruction, { fontSize: scaleFont(16) }]} numberOfLines={2}>
                Escaneando: {selectedEvent?.title || '...'}
              </Text>
            </View>
          )}

          {/* Manual entry toggle (bottom) */}
          {!showManualEntry && (
            <TouchableOpacity
              style={[styles.manualEntryToggle, { marginBottom: insets.bottom + 16 }]}
              onPress={() => setShowManualEntry(true)}
              activeOpacity={0.8}
            >
              <KeyboardIcon size={16} color="rgba(255,255,255,0.6)" />
              <Text style={styles.manualEntryToggleText}>Entrada manual</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Result Modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={closeModal}>
        <View style={styles.modalContainer}>
          <GlassView intensity={40} style={styles.modalContent}>
            {loading ? (
              <DiscoLoader size={90} />
            ) : result ? (
              <>
                <View style={[styles.resultIconContainer, { backgroundColor: result.valid ? '#22c55e' : '#ef4444' }]}>
                  {result.valid ? <Check size={50} color="white" /> : <X size={50} color="white" />}
                </View>

                <Text style={styles.resultTitle}>
                  {result.valid ? 'ENTRADA VÁLIDA' : 'ENTRADA INVÁLIDA'}
                </Text>

                {result.message === 'ENTRADA CADUCADA' && (
                  <View style={styles.expiredBanner}>
                    <Text style={styles.expiredText}>ENTRADA CADUCADA</Text>
                  </View>
                )}

                <Text style={styles.resultMessage}>
                  {result.message || (result.valid ? 'Acceso autorizado' : 'No se permite el acceso')}
                </Text>

                {result.valid && (
                  <View style={styles.ticketDetails}>
                    <Text style={styles.detailLabel}>Asistente:</Text>
                    <Text style={styles.detailValue}>{result.attendee_name || 'Desconocido'}</Text>

                    <Text style={styles.detailLabel}>Tipo:</Text>
                    <Text style={styles.detailValue}>{result.ticket_type || 'General'}</Text>

                    {result.scanned_at && (
                      <Text style={styles.scannedAtText}>
                        Escaneado: {new Date(result.scanned_at).toLocaleTimeString()}
                      </Text>
                    )}
                  </View>
                )}

                {/* Session running total inside modal */}
                {result.valid && sessionScans > 0 && (
                  <View style={styles.sessionCountInsideModal}>
                    <Text style={styles.sessionCountInsideText}>
                      ✅ {sessionScans} escaneado{sessionScans !== 1 ? 's' : ''} esta sesión
                      {eventAccessCount !== null ? `  ·  👥 ${eventAccessCount} en sala` : ''}
                    </Text>
                  </View>
                )}

                <ThemedButton
                  title={result.valid ? 'Siguiente' : 'Reintentar'}
                  onPress={closeModal}
                  style={{ marginTop: 20, width: '100%' }}
                  variant={result.valid ? 'primary' : 'secondary'}
                />
              </>
            ) : null}
          </GlassView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  overlay:   { flex: 1, paddingHorizontal: 20 },

  header: {
    position: 'relative',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  closeButton: {
    position: 'absolute',
    left: 0,
    padding: 8,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    includeFontPadding: false,
  },
  sessionCounterBadge: {
    position: 'absolute',
    right: 0,
    backgroundColor: 'rgba(34,197,94,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  sessionCounterText: {
    color: '#4ade80',
    fontWeight: 'bold',
    fontSize: 13,
  },

  eventSelectorContainer: {
    zIndex: 999,
    marginBottom: 20,
    paddingHorizontal: 10,
    position: 'relative',
  },
  selectorLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginBottom: 5,
    marginLeft: 5,
  },
  eventSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  selectedEventText: { color: 'white', fontSize: 16, fontWeight: '600' },
  dropdownList: {
    position: 'absolute',
    top: '100%',
    left: 10,
    right: 10,
    marginTop: 5,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    maxHeight: 250,
    zIndex: 1000,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  activeDropdownItem: { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
  dropdownText:   { color: 'white', fontSize: 16 },
  activeDropdownText: { color: Colors.dark.primary, fontWeight: 'bold' },
  dropdownDate:   { color: '#999', fontSize: 12, marginTop: 2 },

  scanFrameContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
    zIndex: 1,
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: Colors.dark.primary,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  accessCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(163,230,53,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 14,
  },
  accessCountText: {
    color: '#a3e635',
    fontWeight: '700',
    fontSize: 13,
  },
  scanInstruction: {
    color: 'white',
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 10,
    overflow: 'hidden',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  // Manual entry toggle (footer button)
  manualEntryToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  manualEntryToggleText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },

  // Manual entry card
  manualEntryContainer: {
    flex: 1,
    justifyContent: 'center',
    marginBottom: 20,
  },
  manualEntryCard: {
    padding: 24,
    borderRadius: 20,
    margin: 10,
  },
  manualEntryTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  manualEntrySubtitle: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  manualInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    color: 'white',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }),
  },
  manualActions: {
    flexDirection: 'row',
    gap: 10,
  },
  manualCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  manualCancelText: { color: Colors.dark.textSecondary, fontWeight: '600', fontSize: 15 },
  manualValidateBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  manualValidateText: { color: 'white', fontWeight: 'bold', fontSize: 15 },

  // Modal
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    padding: 30,
    borderRadius: 25,
    alignItems: 'center',
  },
  resultIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  resultTitle:   { fontSize: 24, fontWeight: 'bold', color: 'white', marginBottom: 10, textAlign: 'center' },
  resultMessage: { fontSize: 16, color: Colors.dark.textSecondary, textAlign: 'center', marginBottom: 20 },
  ticketDetails: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 15,
    borderRadius: 15,
    marginBottom: 10,
  },
  detailLabel:   { color: Colors.dark.textSecondary, fontSize: 12, marginBottom: 2 },
  detailValue:   { color: 'white', fontSize: 16, fontWeight: '600', marginBottom: 10 },
  scannedAtText: { color: '#ef4444', fontSize: 12, marginTop: 5, fontStyle: 'italic' },

  sessionCountInsideModal: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 4,
    width: '100%',
    alignItems: 'center',
  },
  sessionCountInsideText: { color: '#4ade80', fontSize: 12, fontWeight: '600' },

  expiredBanner: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 15,
    width: '100%',
    alignItems: 'center',
  },
  expiredText: { color: 'white', fontWeight: 'bold', fontSize: 18, textTransform: 'uppercase' },
});
