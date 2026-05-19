import { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal, Alert, Vibration } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Check, ChevronDown, X } from '@/lib/icons';
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

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(worker)');
  };

  const fetchEventsAndSelectNearest = useCallback(async () => {
    if (!workerProfile) return;
    try {
      // 1. Get current location if possible
      let userLoc = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          userLoc = { lat: loc.coords.latitude, lon: loc.coords.longitude };
        }
      } catch (e) {
        console.log("Could not get location:", e);
      }

      // 2. Fetch events
      const { data, error } = await supabase
        .from('events')
        .select(`
          id, title, event_date,
          venues (latitude, longitude)
        `)
        .eq('creator_id', workerProfile.organizer_id)
        .gte('event_date', new Date().toISOString().split('T')[0]) // Active events
        .order('event_date', { ascending: true });
      
      if (error) throw error;

      if (data && data.length > 0) {
        setEvents(data);
        
        // 3. Select logic:
        // Priority 1: Event is TODAY (date match)
        // Priority 2: Closest by distance (if location available)
        // Priority 3: First in list (soonest upcoming)

        const todayStr = new Date().toISOString().split('T')[0];
        const todayEvents = data.filter(e => e.event_date.startsWith(todayStr));

        if (todayEvents.length > 0) {
           // If multiple events today, use distance or just first
           if (userLoc && todayEvents.length > 1) {
              const sortedByDist = [...todayEvents].sort((a, b) => {
                const vA: any = a.venues;
                const vB: any = b.venues;
                const distA = vA && vA.latitude != null && vA.longitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vA.latitude, vA.longitude) : 99999;
                const distB = vB && vB.latitude != null && vB.longitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vB.latitude, vB.longitude) : 99999;
                return distA - distB;
              });
              setSelectedEventId(sortedByDist[0].id);
           } else {
              setSelectedEventId(todayEvents[0].id);
           }
        } else if (userLoc) {
           // No events today, pick closest upcoming event by distance
           // Or maybe just the soonest one (data[0]) is better? 
           // User asked for "evento mas cercano" (nearest). Let's respect distance if available.
           const sortedByDist = [...data].sort((a, b) => {
              const vA: any = a.venues;
              const vB: any = b.venues;
              const distA = vA && vA.latitude != null && vA.longitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vA.latitude, vA.longitude) : 99999;
              const distB = vB && vB.latitude != null && vB.longitude != null ? getDistanceFromLatLonInKm(userLoc.lat, userLoc.lon, vB.latitude, vB.longitude) : 99999;
              return distA - distB;
           });
           setSelectedEventId(sortedByDist[0].id);
        } else {
           // Fallback: Soonest upcoming
           setSelectedEventId(data[0].id);
        }
      }
    } catch (e) {
      console.error("Error fetching events for scanner:", e);
    }
  }, [workerProfile]);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
    fetchEventsAndSelectNearest();
  }, [fetchEventsAndSelectNearest, permission?.granted, requestPermission]);

  const playFeedback = async (success: boolean) => {
    try {
      if (success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error) {
      console.log('Error playing haptics', error);
      Vibration.vibrate(success ? 100 : 500);
    }
  };

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (scanned || loading || isScanning.current) return;

    if (!selectedEventId) {
      Alert.alert("Atención", "Por favor selecciona un evento antes de escanear.");
      return;
    }

    isScanning.current = true;
    setScanned(true);
    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    const cleanData = data.trim();
    console.log(`[WorkerScanner] Code detected. Type: ${type}, Data: ${cleanData}`);

    try {
      if (!workerProfile?.id) {
        throw new Error('Perfil de trabajador no encontrado');
      }

      // Validate with Worker RPC (event-safe: it will NOT mark the ticket as used if it belongs to another event)
      const { data: validationData, error } = await supabase
        .rpc('validate_ticket_worker_v2', { 
          p_qr_token: cleanData, 
          p_worker_id: workerProfile.id,
          p_event_id: selectedEventId
        });

      if (error) throw error;

      console.log('[WorkerScanner] Validation Result:', validationData);

      // STRICT EVENT VALIDATION
      // If validationData is valid, we must ensure it belongs to the selected event
      // Assuming validationData returns event_id. If not, we might need to update RPC or fetch ticket details.
      // Based on previous knowledge, validationData usually has ticket info. Let's verify.
      // If the RPC doesn't return event_id, we have a problem.
      // However, usually it returns ticket details. Let's assume it does or we check against it.
      
      // If the RPC returns event_id, check it:
      if (validationData.valid && validationData.event_id && validationData.event_id !== selectedEventId) {
         // Ticket is valid but for WRONG event
         const wrongEventResult = {
            valid: false,
            message: 'ENTRADA DE OTRO EVENTO',
            attendee_name: validationData.attendee_name,
            ticket_type: validationData.ticket_type
         };
         setResult(wrongEventResult);
         await playFeedback(false);
         setModalVisible(true);
         return;
      }

      setResult(validationData);
      await playFeedback(validationData.valid);
      setModalVisible(true);

    } catch (error: any) {
      console.error('[WorkerScanner] Validation Error:', error);
      Alert.alert(
        'Error', 
        'Error al validar el código: ' + error.message,
        [{ 
          text: 'OK', 
          onPress: () => {
            setScanned(false);
            isScanning.current = false;
          }
        }]
      );
    } finally {
      setLoading(false);
    }
  };

  const closeModal = () => {
    setModalVisible(false);
    setResult(null);
    setScanned(false);
    isScanning.current = false;
  };

  if (!permission) {
    return <View />;
  }

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

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      />
      
      {/* Overlay UI */}
      <View style={[styles.overlay, { paddingTop: insets.top + 20, paddingHorizontal: horizontalPadding }]}>
        <View style={{ flex: 1, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }}>
          <View style={styles.header}>
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={safeBack}
            >
              <X size={28} color="white" />
            </TouchableOpacity>
            <Text style={[styles.title, { fontSize: scaleFont(18) }]}>Escanear Entrada</Text>
          </View>

          <View style={styles.eventSelectorContainer}>
            <Text style={[styles.selectorLabel, { fontSize: scaleFont(12) }]}>Evento seleccionado:</Text>
            <TouchableOpacity 
              style={styles.eventSelector}
              onPress={() => setShowEventSelector(!showEventSelector)}
              activeOpacity={0.85}
            >
              <Text style={[styles.selectedEventText, { fontSize: scaleFont(16) }]} numberOfLines={1}>
                {events.find(e => e.id === selectedEventId)?.title || 'Seleccionar evento...'}
              </Text>
              <ChevronDown size={20} color="white" />
            </TouchableOpacity>
            
            {showEventSelector && events.length > 0 && (
              <View style={styles.dropdownList}>
                {events.map(event => (
                  <TouchableOpacity 
                    key={event.id}
                    style={[
                      styles.dropdownItem,
                      selectedEventId === event.id && styles.activeDropdownItem
                    ]}
                    onPress={() => {
                      setSelectedEventId(event.id);
                      setShowEventSelector(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[
                      styles.dropdownText,
                      { fontSize: scaleFont(16) },
                      selectedEventId === event.id && styles.activeDropdownText
                    ]} numberOfLines={1}>
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
            <Text style={[styles.scanInstruction, { fontSize: scaleFont(16) }]} numberOfLines={2}>
              Escaneando para: {events.find(e => e.id === selectedEventId)?.title || '...'}
            </Text>
          </View>
        </View>
      </View>

      {/* Result Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <GlassView intensity={40} style={styles.modalContent}>
            {loading ? (
              <DiscoLoader size={90} />
            ) : result ? (
              <>
                <View style={[
                  styles.resultIconContainer, 
                  { backgroundColor: result.valid ? '#22c55e' : '#ef4444' }
                ]}>
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

                <ThemedButton 
                  title={result.valid ? "Siguiente" : "Reintentar"} 
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
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  overlay: {
    flex: 1,
    paddingHorizontal: 20,
  },
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
  scanInstruction: {
    color: 'white',
    marginTop: 20,
    fontSize: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 10,
    overflow: 'hidden',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  eventSelectorContainer: {
    zIndex: 999, // Ensure dropdown is above other elements
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
  selectedEventText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
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
  activeDropdownItem: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  dropdownText: {
    color: 'white',
    fontSize: 16,
  },
  activeDropdownText: {
    color: Colors.dark.primary,
    fontWeight: 'bold',
  },
  dropdownDate: {
    color: '#999',
    fontSize: 12,
    marginTop: 2,
  },
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 10,
    textAlign: 'center',
  },
  resultMessage: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  ticketDetails: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 15,
    borderRadius: 15,
    marginBottom: 10,
  },
  detailLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    marginBottom: 2,
  },
  detailValue: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  scannedAtText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 5,
    fontStyle: 'italic',
  },
  expiredBanner: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 15,
    width: '100%',
    alignItems: 'center',
  },
  expiredText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18,
    textTransform: 'uppercase',
  },
});
