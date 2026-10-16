import { useCallback, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { Ban } from '@/lib/icons';
import { CancellationRequest } from '@/lib/payments/organizerBilling';

type Request = CancellationRequest & { event_title: string; organizer_email: string; reviewed_at: string | null };
type Purchase = { id: string; user_id: string; email: string | null; amount_cents: number; currency: string; status: string; kind: string; commission_cents: number; refund_status: string | null; refund_amount_cents: number | null };
type Detail = { request: Request; event: { title: string }; organizer: { email: string }; purchases: Purchase[]; ticket_count: number; fingerprint: string; collections: { id: string; status: string; amount_cents: number; commission_cents: number; stripe_costs_cents: number }[] };
const money = (cents: number, currency = 'eur') => `${(cents / 100).toFixed(2).replace('.', ',')} ${currency.toUpperCase()}`;
const statusLabel = (status: string) => ({ pending: 'Pendiente de aprobación', approved: 'Aprobada', rejected: 'Rechazada', succeeded: 'Devuelto', processing: 'Procesando', attention: 'Requiere revisión', not_paid: 'No cobrado', fulfilled: 'Compra entregada', paid: 'Pagado', refunded: 'Devuelto', refund_pending: 'Devolución pendiente' }[status] || status);

export default function AdminCancellations() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Request[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = useRef<string | null>(null);
  const generation = useRef(0);
  const submitting = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const list = await supabase.rpc('admin_cancellation_list');
      if (list.error) throw list.error;
      const result = selected.current ? await supabase.rpc('admin_cancellation_details', { p_request: selected.current }) : null;
      if (result?.error) throw result.error;
      if (current === generation.current) { setRows(list.data || []); setDetail(result?.data || null); setError(''); }
    } catch (e: any) { if (current === generation.current) setError(e?.message || 'No se pudo cargar la bandeja.'); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    selected.current = null; setDetail(null); setRows([]); setReason(''); setNotice('');
    if (!user?.id) return;
    void load();
    const timer = setInterval(() => { if (!submitting.current) void load(); }, 15000);
    return () => { ++generation.current; clearInterval(timer); };
  }, [load, user?.id]));
  const open = (id: string) => { selected.current = id; setDetail(null); setReason(''); setNotice(''); void load(); };
  const review = (approve: boolean) => {
    if (!detail || detail.request.status !== 'pending' || reason.trim().length < 3 || submitting.current || loading || error) return;
    Keyboard.dismiss();
    const requestId = detail.request.id, fingerprint = detail.fingerprint, note = reason.trim();
    Alert.alert(approve ? 'Aprobar cancelación' : 'Rechazar solicitud', approve
      ? 'Se cancelará el evento, se invalidarán las entradas y se iniciarán los reembolsos de los pagos confirmados. Stripe descontará lo ya devuelto y conciliará los pagos en curso. Esta acción no se puede deshacer.'
      : 'El evento seguirá activo. El organizador recibirá el motivo del rechazo.', [
      { text: 'Volver', style: 'cancel' },
      { text: approve ? 'Aprobar e iniciar devoluciones' : 'Rechazar', style: 'destructive', onPress: async () => {
        if (submitting.current) return;
        submitting.current = true; setBusy(true); setError(''); setNotice('');
        try {
          const result = await supabase.rpc('admin_review_cancellation', { p_request: requestId, p_approve: approve, p_reason: note, p_fingerprint: fingerprint });
          if (result.error) throw result.error;
          setNotice(approve ? 'Aprobación registrada. Las devoluciones se procesan por separado; revisa sus estados.' : 'Rechazo registrado. No se ha cancelado el evento ni iniciado devoluciones.');
          setReason(''); await load();
        } catch (e: any) { setError(e?.message || 'No se pudo confirmar la decisión. Actualiza antes de reintentar.'); }
        finally { submitting.current = false; setBusy(false); }
      } },
    ]);
  };
  const confirmed = detail?.purchases.filter(p => ['fulfilled', 'paid', 'succeeded', 'refund_pending'].includes(p.status)) || [];
  const euroConfirmed = confirmed.filter(p => p.currency === 'eur');
  const refunded = detail?.purchases.filter(p => p.status === 'refunded' || p.refund_status === 'succeeded') || [];
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={Colors.dark.primary} />}>
      <Ban color={Colors.dark.primary} size={32} /><Text style={styles.title}>Revisión de cancelaciones</Text>
      <Text style={styles.text}>Solo tu aprobación cancela el evento e inicia las devoluciones. Solicitudes pendientes: {rows.filter(r => r.status === 'pending').length}.</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.text}>{notice}</Text>}
      <ThemedButton title="Actualizar bandeja y desglose" variant="outline" disabled={busy} onPress={() => void load()} />
      {detail ? <>
        <ThemedButton title="Volver a la bandeja" variant="outline" disabled={busy} onPress={() => { selected.current = null; setDetail(null); void load(); }} />
        <GlassView contentContainerStyle={styles.card}>
          <Text style={styles.subtitle}>{detail.event.title}</Text>
          <Text style={styles.text}>{statusLabel(detail.request.status)} · {detail.organizer.email}</Text>
          <Text style={styles.text}>Motivo: {detail.request.reason}</Text>
          {!!detail.request.review_reason && <Text style={styles.text}>Decisión: {detail.request.review_reason}</Text>}
          <Text style={styles.text}>Entradas registradas: {detail.ticket_count} · Operaciones de pago: {detail.purchases.length}</Text>
          <Text style={styles.subtitle}>Pagos confirmados sin devolución completa: {money(euroConfirmed.reduce((n, p) => n + p.amount_cents, 0))}</Text>
          <Text style={styles.text}>Devolución completa registrada: {money(refunded.filter(p => p.currency === 'eur').reduce((n, p) => n + p.amount_cents, 0))}</Text>
          <Text style={styles.text}>Comisión Eclipse de esas ventas: {money(euroConfirmed.reduce((n, p) => n + (p.commission_cents || 0), 0))}. No se descuenta al comprador.</Text>
          <Text style={styles.text}>Estos importes proceden de los pagos registrados. Los pagos en curso y devoluciones parciales externas se concilian con Stripe; nunca se devuelve dos veces el mismo importe. Los costes reales de Stripe se muestran después de conciliarlos.</Text>
          <Text selectable style={styles.caption}>Solicitud: {detail.request.id}</Text>
        </GlassView>
        {detail.request.status === 'pending' && <GlassView contentContainerStyle={styles.card}>
          <Text style={styles.subtitle}>Decisión del administrador</Text>
          <TextInput value={reason} onChangeText={setReason} placeholder="Motivo de aprobación o rechazo (mínimo 3 caracteres)" placeholderTextColor={Colors.dark.textSecondary}
            style={styles.input} maxLength={500} accessibilityLabel="Motivo de la decisión" editable={!busy} />
          <ThemedButton title="Aprobar e iniciar devoluciones" loading={busy} disabled={loading || !!error || reason.trim().length < 3} onPress={() => review(true)} />
          <ThemedButton title="Rechazar solicitud" variant="outline" disabled={busy || loading || !!error || reason.trim().length < 3} onPress={() => review(false)} />
        </GlassView>}
        <Text style={styles.subtitle}>Compradores y devoluciones</Text>
        {!detail.purchases.length && <Text style={styles.text}>No hay operaciones de pago registradas para este evento.</Text>}
        {detail.purchases.map(p => <GlassView key={p.id} contentContainerStyle={styles.card}>
          <Text style={styles.subtitle}>{p.email || p.user_id}</Text>
          <Text style={styles.text}>{money(p.amount_cents, p.currency)} · {p.kind === 'vip_table' ? 'Reserva VIP' : 'Entradas'}</Text>
          <Text style={styles.text}>Pago: {statusLabel(p.status)} · Reembolso: {p.refund_status ? statusLabel(p.refund_status) : 'No iniciado por cancelación'}</Text>
          <Text selectable style={styles.caption}>Compra: {p.id}</Text>
        </GlassView>)}
        {detail.collections.map(c => <GlassView key={c.id} contentContainerStyle={styles.card}>
          <Text style={styles.subtitle}>Desglose al organizador</Text>
          <Text style={styles.text}>Comisión: {money(c.commission_cents)} · Stripe conciliado: {money(c.stripe_costs_cents)}</Text>
          <Text style={styles.text}>Total: {money(c.amount_cents)} · {statusLabel(c.status)}</Text>
        </GlassView>)}
      </> : rows.map(r => <GlassView key={r.id} contentContainerStyle={styles.card}>
        <Text style={styles.subtitle}>{r.event_title}</Text><Text style={styles.text}>{statusLabel(r.status)} · {r.organizer_email}</Text>
        <Text style={styles.text}>{r.reason}</Text>
        <ThemedButton title="Ver motivo y desglose" variant="outline" disabled={busy} onPress={() => open(r.id)} />
      </GlassView>)}
      {!loading && !error && !rows.length && <Text style={styles.text}>No hay solicitudes de cancelación.</Text>}
    </ScrollView></KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.dark.background }, content: { padding: 16, gap: 16, paddingBottom: 120 },
  card: { padding: 16, gap: 12 }, title: { fontSize: 26, fontWeight: '800', color: Colors.dark.text },
  subtitle: { fontSize: 18, fontWeight: '700', color: Colors.dark.text }, text: { color: Colors.dark.text, fontSize: 15, lineHeight: 23 },
  caption: { color: Colors.dark.textSecondary, fontSize: 12 }, error: { color: '#ff9d9d', lineHeight: 22 },
  input: { color: Colors.dark.text, borderColor: Colors.dark.border, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 56, fontSize: 16 },
});
