import { LAUNCH_FEATURES } from '@/lib/launchFeatures';
import { View, Text, StyleSheet, Switch, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, LogIn } from '@/lib/icons';
import { useEffect, useRef, useState } from 'react';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { AuthRequiredScreen } from '@/components/ui/AuthRequiredScreen';
import { registerForPushNotifications } from '@/lib/notifications';

type Settings = Record<string, unknown> & { user_id: string };
const ORGANIZER_ONLY_KEYS = ['stock_alerts', 'realtime_sales', 'daily_summary', 'stock_threshold_alerts'] as const;
const COMMON_KEYS = (['purchase_updates', 'event_reminders', 'resale_updates'] as const).filter(key => key !== 'resale_updates' || LAUNCH_FEATURES.resale);
type PreferenceKey = (typeof ORGANIZER_ONLY_KEYS)[number] | (typeof COMMON_KEYS)[number];

export function __test_getVisiblePreferenceKeys(role: string | null | undefined): PreferenceKey[] {
  const r = String(role || '').toLowerCase();
  if (r === 'organizer') return [...COMMON_KEYS, ...ORGANIZER_ONLY_KEYS];
  return [...COMMON_KEYS];
}


const coreItems = [
  { key: 'push_enabled', label: 'Avisos en el teléfono', desc: 'Requiere permiso del sistema y registrar este dispositivo.' },
  { key: 'email_enabled', label: 'Correo electrónico', desc: 'Comunicaciones a tu correo verificado; no activa publicidad.' },
  { key: 'purchase_updates', label: 'Compras y reembolsos', desc: 'Confirmaciones de entradas, mesas VIP y estado de devoluciones.' },
  { key: 'important_updates', label: 'Cambios importantes', desc: 'Cancelaciones, horarios, ubicación y condiciones de acceso.' },
  { key: 'quiet_hours_enabled', label: 'Silenciar de 00:00 a 11:00', desc: 'Hora de Europe/Madrid. Solo push; tus confirmaciones de compra siguen siendo inmediatas. Sin excepción nocturna automática.' },
];
export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const identity = useRef({ uid, epoch: 0 });
  if (identity.current.uid !== uid) identity.current = { uid, epoch: identity.current.epoch + 1 };
  const [settings, setSettings] = useState<Settings | null>(null);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    setSettings(null); setError(''); setNotice(''); setLoading(!!uid); setRole(''); setSaving(false);
    if (!uid) return;
    void Promise.all([
      supabase.from('notification_settings').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('profiles').select('role').eq('id', uid).maybeSingle(),
    ]).then(([pref, profile]) => {
      if (!active) return;
      if (pref.error || profile.error) throw new Error('load');
      setSettings(pref.data ?? { user_id: uid });
      setRole(String(profile.data?.role ?? 'attendee')); // Never use user-editable auth metadata for roles.
    }).catch(() => { if (active) setError('No se pudieron cargar tus preferencias.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, reload]);
  const save = async (key: string, value: boolean) => {
    if (!uid || !settings || settings.user_id !== uid || busy.current) return;
    busy.current = true; setSaving(true); setError(''); setNotice('');
    const epoch = identity.current.epoch;
    try {
      if (key === 'push_enabled' && value && !await registerForPushNotifications(uid, { requestPermission: true })) {
        throw new Error('No se pudo registrar este dispositivo. Revisa los permisos del teléfono y que uses una versión de pruebas compatible.');
      }
      if (identity.current.uid !== uid || identity.current.epoch !== epoch) return;
      const { data, error: failure } = await supabase.rpc('set_core_notification_preferences', { p_values: { [key]: value }, p_user: uid });
      if (failure) throw new Error('No se pudo guardar. La preferencia anterior se conserva.');
      if (identity.current.uid === uid && identity.current.epoch === epoch) setSettings(data as Settings);
    } catch (failure: any) {
      if (identity.current.uid === uid && identity.current.epoch === epoch) setError(String(failure.message || 'No se pudo guardar.'));
    } finally { busy.current = false; if (identity.current.epoch === epoch) setSaving(false); }
  };
  const activate = async () => {
    if (!uid || busy.current) return;
    busy.current = true; setSaving(true); setNotice('');
    const epoch = identity.current.epoch;
    const registered = await registerForPushNotifications(uid, { requestPermission: true });
    if (identity.current.uid === uid && identity.current.epoch === epoch) {
      setNotice(registered ? 'Dispositivo registrado. La entrega se comprobará en el piloto de notificaciones.'
        : 'No se pudo activar. Revisa el permiso de notificaciones en los ajustes del teléfono y vuelve a intentarlo.');
      setSaving(false);
    }
    busy.current = false;
  };
  if (!uid) return <AuthRequiredScreen title="Notificaciones" subtitle="Inicia sesión para gestionar tus avisos." ctaLabel="Iniciar sesión" Icon={LogIn} />;
  const own = settings?.user_id === uid ? settings : null;
  return <View style={styles.container}>
    <LinearGradient colors={['#0F0F1A', '#1A1025', '#0F0F1A']} style={StyleSheet.absoluteFill} />
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}><ArrowLeft size={24} color="white" /></TouchableOpacity>
        <Text style={styles.title}>Preferencias</Text><View style={styles.back} />
      </View>
      {loading ? <View style={styles.loading}><DiscoLoader label="Cargando preferencias" size={120} /></View> :
        <ScrollView contentContainerStyle={styles.content}>
          {!!error && <Text accessibilityRole="alert" style={styles.rowLabel}>{error}</Text>}
          {!own ? <TouchableOpacity accessibilityRole="button" onPress={() => setReload(n => n + 1)} style={styles.back}><Text style={styles.rowLabel}>Reintentar</Text></TouchableOpacity> :
            <GlassView intensity={14} style={styles.card}>
              <Text style={styles.cardTitle}>Tú eliges cómo recibirlos</Text>
              <Text style={styles.cardSub}>El historial de Eclipse se conserva aunque desactives push o correo. Los envíos del piloto se habilitan por separado.</Text>
              <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => void activate()} style={{ paddingVertical: 16 }}>
                <Text style={styles.rowLabel}>Activar en este dispositivo</Text>
              </TouchableOpacity>
              {!!notice && <Text accessibilityLiveRegion="polite" style={styles.cardSub}>{notice}</Text>}
              {coreItems.map(item => <View key={item.key}>
                <View style={styles.divider} /><View style={styles.row}>
                  <View style={styles.rowText}><Text style={styles.rowLabel}>{item.label}</Text><Text style={styles.rowDesc}>{item.desc}</Text></View>
                  <Switch accessibilityLabel={item.label} value={Boolean(own[item.key] ?? item.key !== 'quiet_hours_enabled')}
                    disabled={saving} onValueChange={value => void save(item.key, value)}
                    trackColor={{ false: 'rgba(255,255,255,0.12)', true: Colors.dark.primary }} thumbColor="#fff" />
                </View>
              </View>)}
              <View style={styles.divider} />
              <Text style={styles.rowLabel}>Promociones desactivadas</Text>
              <Text style={styles.rowDesc}>No se activan al permitir notificaciones de compras. Se decidirán en una fase independiente.</Text>
              <View style={styles.divider} />
              <Text style={styles.rowLabel}>Próxima etapa</Text>
              <Text style={styles.rowDesc}>{role === 'organizer' ? 'Recordatorios, ventas agrupadas y alertas de inventario: pendientes de implementación y activación.' : 'Recordatorios de eventos: pendientes de implementación y activación.'}</Text>
            </GlassView>}
        </ScrollView>}
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A' },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  back: { width: 44, height: 44, justifyContent: 'center' },
  title: { color: 'white', fontSize: 18, fontWeight: '800' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 40 },
  card: { borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cardTitle: { color: 'white', fontSize: 16, fontWeight: '800' },
  cardSub: { color: Colors.dark.textSecondary, marginTop: 6, fontSize: 13, lineHeight: 18 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  rowText: { flex: 1 },
  rowLabel: { color: 'white', fontSize: 14, fontWeight: '800' },
  rowDesc: { color: 'rgba(255,255,255,0.60)', marginTop: 4, fontSize: 12, lineHeight: 16 },
});

