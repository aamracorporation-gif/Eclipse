import { View, Text, StyleSheet, TouchableOpacity, Alert, Share, ActivityIndicator, ScrollView } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, RefreshCw, Share2, Users, QrCode } from '@/lib/icons';
import QRCode from 'react-native-qrcode-svg';

export default function WorkerQRScreen() {
  const { event_id, event_title } = useLocalSearchParams<{ event_id: string; event_title?: string }>();
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState<string>(
    event_title ? decodeURIComponent(event_title) : 'Evento'
  );
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const safeBack = () => {
    const canGoBack = (router as any)?.canGoBack?.();
    if (canGoBack) router.back();
    else router.replace('/(creator)/manage-events');
  };

  const fetchToken = useCallback(async () => {
    if (!event_id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('events')
        .select('worker_invite_token, title')
        .eq('id', event_id)
        .single();

      if (error) throw error;
      setToken(String(data.worker_invite_token || ''));
      if (data.title) setEventTitle(String(data.title));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el token');
    } finally {
      setLoading(false);
    }
  }, [event_id]);

  useEffect(() => {
    fetchToken();
  }, [fetchToken]);

  const handleRegenerate = () => {
    Alert.alert(
      'Regenerar QR',
      'El QR anterior quedará inválido. Los workers que aún no hayan escaneado necesitarán el nuevo código. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Regenerar',
          style: 'destructive',
          onPress: async () => {
            try {
              setRegenerating(true);
              const { data, error } = await supabase.rpc('regenerate_worker_invite_token', {
                p_event_id: event_id,
              });
              if (error) throw error;
              setToken(String(data));
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'No se pudo regenerar el token');
            } finally {
              setRegenerating(false);
            }
          },
        },
      ]
    );
  };

  const handleShare = async () => {
    if (!token) return;
    try {
      await Share.share({
        message: `🎪 ${eventTitle}\n\nAcceso Workers — Eclipse\nCódigo de invitación: ${token}\n\nEscanea el QR desde la app de Eclipse para unirte como worker a este evento.`,
        title: `QR Workers — ${eventTitle}`,
      });
    } catch {}
  };

  const buildQRContent = (eventId: string, t: string) =>
    JSON.stringify({ type: 'eclipse_worker_invite', event_id: eventId, token: t });

  const qrContent = event_id && token ? buildQRContent(event_id, token) : null;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1e1b4b', '#0d0d2b']} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={safeBack} style={styles.backBtn}>
            <ChevronLeft size={24} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.headerTitle}>QR Workers</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{eventTitle}</Text>
          </View>
          <TouchableOpacity onPress={handleShare} style={styles.shareBtn} disabled={!token || loading}>
            <Share2 size={20} color="white" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* QR Card */}
          <GlassView intensity={20} style={styles.qrCard}>
            <View style={styles.qrHeader}>
              <View style={styles.qrIconWrap}>
                <Users size={20} color="#7C3AED" />
              </View>
              <Text style={styles.qrCardTitle}>Acceso Workers</Text>
            </View>

            <View style={styles.qrWrap}>
              {loading ? (
                <View style={styles.qrPlaceholder}>
                  <ActivityIndicator size="large" color="#7C3AED" />
                </View>
              ) : qrContent ? (
                <View style={styles.qrFrame}>
                  <QRCode
                    value={qrContent}
                    size={220}
                    color="#ffffff"
                    backgroundColor="transparent"
                    logo={undefined}
                    quietZone={12}
                  />
                </View>
              ) : (
                <View style={styles.qrPlaceholder}>
                  <QrCode size={48} color="rgba(255,255,255,0.3)" />
                  <Text style={styles.qrPlaceholderTxt}>Sin token</Text>
                </View>
              )}
            </View>

            {token && !loading && (
              <View style={styles.tokenRow}>
                <Text style={styles.tokenLabel}>Código</Text>
                <Text style={styles.tokenValue} numberOfLines={1} ellipsizeMode="middle">
                  {token}
                </Text>
              </View>
            )}
          </GlassView>

          {/* Instructions */}
          <GlassView intensity={12} style={styles.infoCard}>
            <Text style={styles.infoTitle}>¿Cómo funciona?</Text>
            {[
              { n: '1', text: 'Muestra este QR a tus workers en su incorporación.' },
              { n: '2', text: 'El worker abre Eclipse, va a Perfil → Unirme como worker, y escanea el código.' },
              { n: '3', text: 'Automáticamente quedan vinculados a este evento con permisos de escaneo.' },
              { n: '4', text: 'El QR expira al regenerarlo. Úsalo solo si alguien no autorizado lo ve.' },
            ].map(step => (
              <View key={step.n} style={styles.step}>
                <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.stepNum}>
                  <Text style={styles.stepNumTxt}>{step.n}</Text>
                </LinearGradient>
                <Text style={styles.stepTxt}>{step.text}</Text>
              </View>
            ))}
          </GlassView>

          {/* Regenerate button */}
          <TouchableOpacity
            onPress={handleRegenerate}
            style={styles.regenBtn}
            activeOpacity={0.75}
            disabled={loading || regenerating}
          >
            {regenerating
              ? <ActivityIndicator size="small" color="#EF4444" />
              : <RefreshCw size={16} color="#EF4444" />}
            <Text style={styles.regenTxt}>
              {regenerating ? 'Regenerando...' : 'Regenerar QR (invalida el actual)'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: 'white' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  shareBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(124,58,237,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },

  qrCard: { borderRadius: 24, padding: 24, alignItems: 'center' },
  qrHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  qrIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  qrCardTitle: { fontSize: 17, fontWeight: '800', color: 'white' },

  qrWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  qrFrame: {
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
  },
  qrPlaceholder: {
    width: 252, height: 252,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  qrPlaceholderTxt: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },

  tokenRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    width: '100%',
  },
  tokenLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  tokenValue: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'monospace' },

  infoCard: { borderRadius: 20, padding: 20, gap: 14 },
  infoTitle: { fontSize: 15, fontWeight: '800', color: 'white', marginBottom: 4 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  stepNumTxt: { color: 'white', fontSize: 11, fontWeight: '800' },
  stepTxt: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },

  regenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 14,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  regenTxt: { color: '#EF4444', fontSize: 14, fontWeight: '700' },
});
