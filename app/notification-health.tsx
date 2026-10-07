import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from '@/lib/icons';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { notificationHealthSummary, NOTIFICATION_DELIVERY_LABELS, type NotificationHealth } from '@/lib/notificationHealth';

const yesNo = (v: boolean | null) => v === null ? 'Sin comprobar' : v ? 'Sí' : 'No';
const time = (v: string | null) => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('es-ES') : 'Sin registro';
export default function NotificationHealthScreen() {
  const router = useRouter(); const { user } = useAuth(); const uid = user?.id ?? '';
  const owner = useRef(uid); owner.current = uid;
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<{ owner: string; data: NotificationHealth } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setLoading(true); setSnapshot(null); setError('');
    if (!uid) { setLoading(false); setError('Inicia sesión con una cuenta administradora.'); return; }
    void Promise.resolve(supabase.rpc('notification_health_v2')).then(({ data, error: failure }) => {
      if (!active || owner.current !== uid) return;
      if (failure || !data?.worker || !Array.isArray(data.by_channel)) throw new Error('No se pudo consultar el diagnóstico. Se requiere una cuenta administradora activa y el servidor actualizado.');
      setSnapshot({ owner: uid, data: data as NotificationHealth });
    }).catch(e => { if (active && owner.current === uid) setError(e instanceof Error ? e.message : 'No se pudo consultar el diagnóstico.'); })
      .finally(() => { if (active && owner.current === uid) setLoading(false); });
    return () => { active = false; };
  }, [uid, reload]);
  const h = snapshot?.owner === uid ? snapshot.data : null;
  const summary = h ? notificationHealthSummary(h) : null;
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.heading}><TouchableOpacity accessibilityLabel="Volver" onPress={() => router.back()}><ArrowLeft size={24} color="#FFFFFF" /></TouchableOpacity><Text style={styles.title}>Estado de notificaciones</Text></View>
    <Text style={styles.help}>Administración · solo lectura. Esta pantalla no activa envíos ni muestra direcciones, tokens o contenido privado.</Text>
    {loading ? <ActivityIndicator accessibilityLabel="Consultando diagnóstico" color="#C5ABFF" /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {h && summary ? <>
      <View style={styles.card}><Text style={styles.subtitle}>{summary.title}</Text><Text style={styles.help}>{summary.detail}</Text><Text style={styles.help}>Consulta: {time(h.checked_at)}</Text></View>
      <View style={styles.card}><Text style={styles.subtitle}>Protecciones y piloto</Text>
        <Text style={styles.text}>Captura: {yesNo(h.capture_enabled)}</Text><Text style={styles.text}>Ventas y disponibilidad: {yesNo(h.operations_enabled)}</Text>
        <Text style={styles.text}>Envíos externos: {yesNo(h.live_delivery_enabled)}</Text><Text style={styles.text}>Todos los destinatarios: {yesNo(h.allow_all_recipients)}</Text>
        <Text style={styles.text}>Destinatarios del piloto: {h.pilot_recipient_count}</Text><Text style={styles.text}>Instalaciones activas: {h.active_installations}</Text></View>
      <View style={styles.card}><Text style={styles.subtitle}>Cola y ejecución</Text><Text style={styles.text}>Avisos por preparar: {h.outbox_pending}</Text><Text style={styles.text}>Ventas por agrupar: {h.sales_pending}</Text>
        <Text style={styles.text}>Última ejecución completada: {time(h.worker.last_completed_at)}</Text><Text style={styles.text}>Último fallo: {time(h.worker.last_failed_at)}</Text>
        <Text style={styles.text}>Trabajo vencido: {h.expired_leases}</Text><Text style={styles.text}>Recibos retrasados: {h.delayed_receipts}</Text>
        <Text style={styles.help}>Configuración declarada por el proceso: push {yesNo(h.worker.push_configured)}, correo {yesNo(h.worker.email_configured)}. No comprueba por sí sola credenciales ni recepción.</Text></View>
      <View style={styles.card}><Text style={styles.subtitle}>Entregas por canal</Text>{h.by_channel.length === 0 ? <Text style={styles.help}>Todavía no hay entregas registradas.</Text> : h.by_channel.map(row => <Text key={`${row.channel}:${row.status}`} style={styles.text}>{row.channel === 'push' ? 'Móvil' : 'Correo'} · {NOTIFICATION_DELIVERY_LABELS[row.status] ?? row.status}: {row.total}</Text>)}
        <Text style={styles.help}>Aceptar un envío no significa recibirlo o leerlo. Los recibos de móvil confirman la aceptación del proveedor, no la lectura. El seguimiento de entrega y rebote de correo sigue pendiente.</Text></View>
      {h.errors_24h.length > 0 ? <View style={styles.card}><Text style={styles.subtitle}>Fallos de las últimas 24 horas</Text>{h.errors_24h.map((row, i) => <Text key={i} style={styles.text}>{row.code ?? 'Sin código'}: {row.total}</Text>)}</View> : null}
    </> : null}
    <TouchableOpacity disabled={loading} style={styles.button} onPress={() => setReload(n => n + 1)}><Text style={styles.text}>Actualizar diagnóstico</Text></TouchableOpacity>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#151020' }, content: { padding: 22, gap: 18, paddingBottom: 48, maxWidth: 750, width: '100%', alignSelf: 'center' }, heading: { flexDirection: 'row', alignItems: 'center', gap: 14 }, title: { flex: 1, color: '#FFFFFF', fontSize: 24, fontWeight: '700' }, subtitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' }, text: { color: '#F1EAF9', fontSize: 15, lineHeight: 23 }, help: { color: '#B7AEC6', fontSize: 13, lineHeight: 20 }, card: { padding: 18, backgroundColor: '#251C33', borderRadius: 18, gap: 10 }, error: { color: '#FFC3CF', lineHeight: 22 }, button: { padding: 16, borderColor: '#9570C5', borderWidth: 1, borderRadius: 12, alignItems: 'center' } });
