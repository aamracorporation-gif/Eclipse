import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, QrCode, Check } from '@/lib/icons';
import { supabase } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';

export default function JoinWorkerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ event_title: string } | null>(null);
  const scannedRef = useRef(false);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(tabs)/profile');
  };

  useEffect(() => {
    if (scanning) scannedRef.current = false;
  }, [scanning]);

  const handleScan = async ({ data }: { data: string }) => {
    if (scannedRef.current || busy) return;
    scannedRef.current = true;
    setScanning(false);

    let parsed: { type?: string; event_id?: string; token?: string } = {};
    try {
      parsed = JSON.parse(data);
    } catch {
      Alert.alert('QR inválido', 'Este código QR no es un acceso de worker de Eclipse.', [
        { text: 'Volver a escanear', onPress: () => setScanning(true) },
        { text: 'Cancelar' },
      ]);
      return;
    }

    if (parsed.type !== 'eclipse_worker_invite' || !parsed.event_id || !parsed.token) {
      Alert.alert('QR inválido', 'Este código QR no es un acceso de worker de Eclipse.', [
        { text: 'Volver a escanear', onPress: () => setScanning(true) },
        { text: 'Cancelar' },
      ]);
      return;
    }

    setBusy(true);
    try {
      const { data: result, error } = await supabase.rpc('join_event_as_worker', {
        p_event_id: parsed.event_id,
        p_invite_token: parsed.token,
      });
      if (error) throw error;

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess({ event_title: String((result as any)?.event_title || 'el evento') });
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', e?.message || 'No se pudo unir al evento.', [
        { text: 'Reintentar', onPress: () => setScanning(true) },
        { text: 'Cancelar' },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (success) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={[Colors.dark.background, '#0d2b1e']} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.successWrap}>
            <LinearGradient colors={['#22c55e', '#16a34a']} style={styles.successIcon}>
              <Check size={40} color="white" />
            </LinearGradient>
            <Text style={styles.successTitle}>¡Acceso concedido!</Text>
            <Text style={styles.successBody}>
              Te has unido como worker a{'\n'}
              <Text style={{ color: 'white', fontWeight: '800' }}>{success.event_title}</Text>
            </Text>
            <Text style={styles.successHint}>
              Ahora puedes usar el escáner de tickets para validar entradas en este evento.
            </Text>
            <TouchableOpacity onPress={safeBack} style={styles.doneBtn} activeOpacity={0.8}>
              <LinearGradient colors={['#22c55e', '#16a34a']} style={styles.doneBtnGrad}>
                <Text style={styles.doneBtnTxt}>Listo</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (scanning) {
    if (!permission?.granted) {
      return (
        <View style={styles.container}>
          <LinearGradient colors={[Colors.dark.background, '#1e1b4b']} style={StyleSheet.absoluteFill} />
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.permWrap}>
              <QrCode size={48} color="rgba(255,255,255,0.3)" />
              <Text style={styles.permTitle}>Permiso de cámara</Text>
              <Text style={styles.permBody}>Necesitamos acceso a la cámara para escanear el QR de acceso.</Text>
              <TouchableOpacity onPress={requestPermission} style={styles.permBtn} activeOpacity={0.8}>
                <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.permBtnGrad}>
                  <Text style={styles.permBtnTxt}>Permitir acceso</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setScanning(false)} style={{ marginTop: 16 }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: 'black' }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy ? undefined : handleScan}
        />
        {/* Dark overlay with cutout */}
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.overlayTop} />
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={styles.scanFrame} />
            <View style={styles.overlaySide} />
          </View>
          <View style={styles.overlayBottom} />
        </View>

        <SafeAreaView style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <TouchableOpacity onPress={() => setScanning(false)} style={styles.scanBackBtn}>
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>
          <View style={styles.scanHintWrap}>
            {busy
              ? <ActivityIndicator size="large" color="white" />
              : <Text style={styles.scanHint}>Apunta al QR que te muestra el organizador</Text>}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1e1b4b']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backBtn}>
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Unirme como Worker</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.homeWrap}>
          <GlassView intensity={18} style={styles.introCard}>
            <View style={styles.introIconWrap}>
              <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.introIcon}>
                <QrCode size={32} color="white" />
              </LinearGradient>
            </View>
            <Text style={styles.introTitle}>Acceso de Worker</Text>
            <Text style={styles.introBody}>
              El organizador del evento tiene un QR de acceso en su pantalla.{'\n\n'}
              Escanéalo para registrarte como worker y poder validar entradas.
            </Text>
          </GlassView>

          <TouchableOpacity
            onPress={async () => {
              if (!permission?.granted) await requestPermission();
              setScanning(true);
            }}
            style={styles.scanBtn}
            activeOpacity={0.85}
          >
            <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.scanBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <QrCode size={22} color="white" />
              <Text style={styles.scanBtnTxt}>Escanear QR del organizador</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const FRAME = 240;
const OVERLAY_COLOR = 'rgba(0,0,0,0.65)';

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: 'white' },

  homeWrap: { flex: 1, padding: 20, gap: 20, justifyContent: 'center' },

  introCard: { borderRadius: 24, padding: 28, alignItems: 'center', gap: 16 },
  introIconWrap: { marginBottom: 4 },
  introIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  introTitle: { fontSize: 20, fontWeight: '800', color: 'white', textAlign: 'center' },
  introBody: { fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22 },

  scanBtn: { borderRadius: 16, overflow: 'hidden' },
  scanBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18 },
  scanBtnTxt: { color: 'white', fontSize: 16, fontWeight: '800' },

  // Scanner overlay
  overlay: { ...StyleSheet.absoluteFillObject },
  overlayTop: { flex: 1, backgroundColor: OVERLAY_COLOR },
  overlayMiddle: { flexDirection: 'row', height: FRAME },
  overlaySide: { flex: 1, backgroundColor: OVERLAY_COLOR },
  scanFrame: {
    width: FRAME, height: FRAME,
    borderRadius: 20,
    borderWidth: 2, borderColor: '#7C3AED',
  },
  overlayBottom: { flex: 1, backgroundColor: OVERLAY_COLOR },
  scanBackBtn: {
    margin: 20, width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  scanHintWrap: { position: 'absolute', bottom: 60, left: 0, right: 0, alignItems: 'center' },
  scanHint: { color: 'white', fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: 40 },

  // Permission
  permWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 },
  permTitle: { color: 'white', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  permBody: { color: 'rgba(255,255,255,0.6)', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  permBtn: { borderRadius: 14, overflow: 'hidden', width: '100%', marginTop: 8 },
  permBtnGrad: { paddingVertical: 16, alignItems: 'center' },
  permBtnTxt: { color: 'white', fontSize: 16, fontWeight: '700' },

  // Success
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 20 },
  successIcon: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  successTitle: { color: 'white', fontSize: 26, fontWeight: '900', textAlign: 'center' },
  successBody: { color: 'rgba(255,255,255,0.65)', fontSize: 16, textAlign: 'center', lineHeight: 24 },
  successHint: { color: 'rgba(255,255,255,0.45)', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  doneBtn: { borderRadius: 16, overflow: 'hidden', width: '100%', marginTop: 8 },
  doneBtnGrad: { paddingVertical: 18, alignItems: 'center' },
  doneBtnTxt: { color: 'white', fontSize: 17, fontWeight: '800' },
});
