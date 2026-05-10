import { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Modal, Alert, Vibration } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { AlertTriangle, Check, X } from '@/lib/icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

export default function ScanScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const isScanning = useRef(false);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)');
  };

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  const playFeedback = async (success: boolean) => {
    try {
      if (success) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (error) {
      console.log('Error playing haptics', error);
      // Fallback to vibration
      Vibration.vibrate(success ? 100 : 500);
    }
  };

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (scanned || loading || isScanning.current) return;

    // 1. Immediate Feedback & Lock
    isScanning.current = true;
    setScanned(true);
    setLoading(true);
    // Short haptic to indicate "scan captured" before validation
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    // Clean data
    const cleanData = data.trim();
    console.log(`[Scanner] Code detected. Type: ${type}, Data: ${cleanData}`);

    try {
      if (!user?.id) {
        throw new Error(t('errors.session_expired'));
      }

      // Validate with Supabase RPC (v2)
      // We use v2 because it handles RLS bypassing and Type casting (UUID/Text) safely
      const { data: validationData, error } = await supabase
        .rpc('validate_ticket_qr_v2', { 
          p_qr_token: cleanData, 
          p_scanned_by_text: user.id 
        });

      if (error) throw error;

      console.log('[Scanner] Validation Result:', validationData);
      setResult(validationData);
      await playFeedback(validationData.valid);
      setModalVisible(true);

    } catch (error: any) {
      console.error('[Scanner] Validation Error:', error);
      // DO NOT reset scanned here immediately, or it loops.
      // Show Alert and reset ONLY when user presses OK
      Alert.alert(
        t('common.error'),
        t('creator.scan.validation_error', { detail: error.message }),
        [{ 
          text: t('common.ok'), 
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
    // Add a small delay before allowing next scan to prevent accidental double scans
    setTimeout(() => {
      setScanned(false);
      isScanning.current = false;
    }, 1000);
  };

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>{t('creator.scan.camera_permission_body')}</Text>
        <ThemedButton onPress={requestPermission} title={t('creator.scan.camera_permission_cta')} />
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
      <View style={[styles.overlay, { paddingTop: insets.top + 20 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backButton}>
            <X size={28} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>{t('creator.scan.title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.scanFrameContainer}>
           <View style={styles.scanFrame} />
           <Text style={styles.scanText}>{t('creator.scan.aim_qr')}</Text>
        </View>
        
        {loading && (
           <View style={styles.loadingOverlay}>
             <DiscoLoader size={90} />
             <Text style={styles.loadingText}>{t('creator.scan.validating')}</Text>
           </View>
        )}
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
             {result?.valid ? (
               <View style={styles.resultContent}>
                 <View style={[styles.iconCircle, { backgroundColor: '#4ade80' }]}>
                   <Check size={50} color="white" />
                 </View>
                 <Text style={styles.resultTitle}>{t('creator.scan.valid_title')}</Text>
                 <Text style={styles.resultMessage}>{result.message}</Text>
                 
                 <View style={styles.ticketInfo}>
                   <Text style={styles.infoLabel}>{t('creator.scan.labels.event')}</Text>
                   <Text style={styles.infoValue}>{result.ticket?.event}</Text>
                   
                   <Text style={styles.infoLabel}>{t('creator.scan.labels.holder')}</Text>
                   <Text style={styles.infoValue}>{result.ticket?.owner}</Text>

                   <Text style={styles.infoLabel}>{t('creator.scan.labels.date')}</Text>
                   <Text style={styles.infoValue}>
                      {result.ticket?.date ? new Date(result.ticket.date).toLocaleDateString() : t('creator.scan.na')}
                   </Text>
                 </View>
               </View>
             ) : (
               <View style={styles.resultContent}>
                 <View style={[styles.iconCircle, { backgroundColor: '#ef4444' }]}>
                   <X size={50} color="white" />
                 </View>
                 <Text style={[styles.resultTitle, { color: '#ef4444' }]}>{t('creator.scan.invalid_title')}</Text>
                 
                 {(() => {
                   const msg = result?.message?.toUpperCase() || '';
                   const isExpired = msg.includes('YA FUE UTILIZADA') || msg.includes('YA UTILIZADA') || msg.includes('USED');
                   
                   return isExpired && (
                     <View style={styles.expiredBanner}>
                       <AlertTriangle size={24} color="white" />
                       <Text style={styles.expiredText}>{t('creator.scan.expired_banner')}</Text>
                     </View>
                   );
                 })()}

                 <Text style={styles.resultMessage}>{result?.message || t('creator.scan.not_recognized')}</Text>
                 
                 {result?.ticket && (
                   <View style={styles.errorInfo}>
                     <Text style={styles.errorText}>
                        {t('creator.scan.previously_scanned', { at: new Date(result.ticket.scanned_at).toLocaleString() })}
                     </Text>
                   </View>
                 )}
               </View>
             )}

             <ThemedButton 
               title={result?.valid ? t('creator.scan.next_scan') : t('common.cancel')} 
               onPress={closeModal}
               style={styles.modalButton}
               variant={result?.valid ? "primary" : "outline"}
             />
          </GlassView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  message: {
    textAlign: 'center',
    paddingBottom: 10,
    color: 'white',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  backButton: {
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  scanFrameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: Colors.dark.primary,
    backgroundColor: 'transparent',
    borderRadius: 20,
  },
  scanText: {
    color: 'white',
    marginTop: 20,
    fontSize: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 5,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: 'white',
    marginTop: 10,
    fontSize: 18,
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
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#1e1b4b', // Fallback
  },
  resultContent: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  resultTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#4ade80',
    marginBottom: 10,
  },
  resultMessage: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    marginBottom: 20,
  },
  ticketInfo: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: 15,
  },
  infoLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    marginTop: 5,
  },
  infoValue: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorInfo: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 8,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
  },
  modalButton: {
    width: '100%',
    marginTop: 10,
  },
  expiredBanner: {
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 15,
  },
  expiredText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18,
    textTransform: 'uppercase',
  },
});
