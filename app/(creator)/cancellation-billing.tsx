import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, findNodeHandle, Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useOrganizerStripe } from '@/lib/payments/useOrganizerStripe';
import * as Linking from 'expo-linking';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { organizerBillingRequest, organizerBillingVisible } from '@/lib/payments/organizerBilling';
import { useCancellationOverview } from '@/lib/payments/useCancellationOverview';
import { useEvents } from '@/lib/EventContext';
import { Ban, ShieldCheck } from '@/lib/icons';

const euros = (value: number) => `${(value / 100).toFixed(2).replace('.', ',')} €`;
const states: Record<string, string> = { refunding: 'Devoluciones en curso', reconciliation: 'Calculando costes reales',
  collection_pending: 'Desglose disponible', requires_action: 'Pago pendiente de completar', collected: 'Devoluciones completadas', attention: 'En revisión' };

export default function CancellationBillingScreen() {
  const router = useRouter();
  const { event_id: eventParam } = useLocalSearchParams<{ event_id?: string | string[] }>();
  const eventId = Array.isArray(eventParam) ? eventParam[0] : eventParam;
  const insets = useSafeAreaInsets();
  const { getEventById, refreshEvents } = useEvents();
  const stripe = useOrganizerStripe();
  const { data, error: refreshError, loading, refresh } = useCancellationOverview();
  const [accepted, setAccepted] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ eventId: string; id: string } | null>(null);
  const scroll = useRef<ScrollView>(null);
  const reasonInput = useRef<TextInput>(null);
  const focusReason = useCallback(() => {
    if (Platform.OS === 'web') return;
    const node = findNodeHandle(reasonInput.current);
    if (node != null) scroll.current?.getScrollResponder()?.scrollResponderScrollNativeHandleToKeyboard(node, 24, true);
  }, []);
  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidShow', () => {
      if (reasonInput.current?.isFocused()) focusReason();
    });
    return () => listener.remove();
  }, [focusReason]);
  useEffect(() => { setReason(''); setReceipt(null); setError(''); }, [eventId]);
  const active = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { active.current = false; setBusy(false); }
  };
  const saveCard = () => run(async () => {
    if (!data || !accepted) return;
    if (Platform.OS === 'web') throw new Error('Guarda tu tarjeta desde la app de iOS o Android.');
    const setup = await organizerBillingRequest<{ setupId: string; clientSecret: string }>('/setup', {
      accepted: true, version: data.policy.version, sha256: data.policy.sha256,
    });
    const initialized = await stripe.initPaymentSheet({ merchantDisplayName: 'Eclipse', setupIntentClientSecret: setup.clientSecret,
      returnURL: Linking.createURL('stripe-redirect'), allowsDelayedPaymentMethods: false });
    if (initialized.error) throw new Error(initialized.error.message);
    const presented = await stripe.presentPaymentSheet();
    if (presented.error?.code === 'Canceled') return;
    if (presented.error) throw new Error(presented.error.message);
    const verified = await organizerBillingRequest<{ ready: boolean }>(`/setup/${setup.setupId}/confirm`, {});
    if (!verified.ready) throw new Error('La autorización sigue pendiente. Actualiza el estado en unos instantes.');
    setAccepted(false);
  });
  const cancel = () => {
    if (!eventId || !data?.ready || reason.trim().length < 3 || active.current || receipt?.eventId === eventId) return;
    Keyboard.dismiss();
    Alert.alert('Solicitar cancelación',
    'El administrador revisará el motivo y el desglose de las devoluciones. Hasta que apruebe la solicitud, el evento seguirá activo y no se iniciarán reembolsos ni cargos por cancelación.', [
      { text: 'Volver', style: 'cancel' }, { text: 'Enviar solicitud', onPress: () => void run(async () => {
        const result = await organizerBillingRequest<{ cancellationId: string; status: string }>(`/events/${eventId}/cancel`, { reason: reason.trim() });
        if (!result.cancellationId) throw new Error('No se pudo confirmar la cancelación. Actualiza el historial antes de reintentarlo.');
        setReceipt({ eventId, id: result.cancellationId });
        setReason('');
        void refreshEvents().catch(() => { /* The confirmed receipt remains valid if the event list is offline. */ });
      }) },
    ]);
  };
  const pay = (id: string) => run(async () => {
    if (Platform.OS === 'web') throw new Error('Completa el pago desde la app de iOS o Android.');
    const result = await organizerBillingRequest<{ status: string; clientSecret?: string }>(`/collections/${id}/pay`, {});
    if (result.clientSecret && result.status === 'requires_action') {
      const confirmed = await stripe.handleNextAction(result.clientSecret);
      if (confirmed.error) throw new Error(confirmed.error.message);
    } else if (result.clientSecret) {
      const initialized = await stripe.initPaymentSheet({ merchantDisplayName: 'Eclipse', paymentIntentClientSecret: result.clientSecret,
        returnURL: Linking.createURL('stripe-redirect'), allowsDelayedPaymentMethods: false });
      if (initialized.error) throw new Error(initialized.error.message);
      const presented = await stripe.presentPaymentSheet();
      if (presented.error?.code === 'Canceled') return;
      if (presented.error) throw new Error(presented.error.message);
    }
    Alert.alert('Pago enviado', 'El estado se actualizará cuando Stripe lo confirme.');
  });
  const existing = receipt?.eventId === eventId || data?.cancellations.some(c => c.event_id === eventId)
    || data?.requests?.some(r => r.event_id === eventId && r.status !== 'rejected');
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={Colors.dark.primary} />}
      contentContainerStyle={[styles.content, { paddingBottom: 100 + insets.bottom }]}>
    <ThemedButton title="Volver" variant="outline" onPress={() => router.back()} />
    <View style={styles.hero}>
      <View style={styles.icon}><Ban size={30} color={Colors.dark.primary} /></View>
      <Text style={styles.eyebrow}>GESTIÓN DE EVENTOS</Text>
      <Text style={styles.title}>Cancelaciones</Text>
      <Text style={styles.text}>Tus solicitudes, devoluciones y costes, en un solo lugar.</Text>
    </View>
    {!organizerBillingVisible ? <Text style={styles.text}>Esta función todavía no está disponible.</Text> : <>
      <Text style={styles.text}>La cancelación necesita aprobación del administrador. No se iniciarán devoluciones ni cargos por cancelación hasta que la apruebe.</Text>
      {!!(error || refreshError) && <View style={styles.warning}><Text accessibilityRole="alert" style={styles.error}>{error || refreshError}</Text>
        <ThemedButton title="Reintentar actualización" variant="outline" onPress={() => void refresh()} /></View>}
      {loading && !data && <Text style={styles.text}>Cargando tu historial…</Text>}
      {receipt && <View style={styles.notice} accessibilityLiveRegion="polite">
        <ShieldCheck size={24} color={Colors.dark.primary} />
        <Text style={styles.subtitle}>Solicitud enviada</Text>
        <Text style={styles.text}>Consulta abajo la decisión del administrador. El evento solo se cancelará y se tramitarán devoluciones si se aprueba.</Text>
        <Text selectable style={styles.caption}>Referencia: {receipt.id}</Text>
      </View>}
      {eventId && !existing && <GlassView contentContainerStyle={styles.card}>
        <Text style={styles.eyebrow}>EVENTO SELECCIONADO</Text>
        <Text style={styles.subtitle}>{getEventById(eventId)?.title || 'Solicitar cancelación de este evento'}</Text>
        <Text style={styles.text}>Explica el motivo. Antes de enviar, podrás revisar las consecuencias de la cancelación.</Text>
        <Text style={styles.label}>Motivo de la cancelación</Text>
        <TextInput ref={reasonInput} value={reason} onChangeText={setReason} multiline maxLength={500}
          onFocus={focusReason} onContentSizeChange={() => { if (reasonInput.current?.isFocused()) focusReason(); }} scrollEnabled={false} editable={!busy}
          accessibilityLabel="Motivo de la cancelación" placeholder="Cuéntanos qué ha ocurrido…"
          placeholderTextColor={Colors.dark.textSecondary} style={styles.input} />
        <Text style={styles.caption}>{reason.length}/500 · Mínimo 3 caracteres</Text>
        {!data?.ready && <Text style={styles.text}>Primero autoriza una tarjeta en el apartado de abajo. No se cobra una fianza.</Text>}
        <ThemedButton title="Solicitar aprobación" disabled={!data?.ready || reason.trim().length < 3} loading={busy} onPress={cancel} />
      </GlassView>}
      {data && <GlassView contentContainerStyle={styles.card}>
        <Text style={styles.subtitle}>{data.ready ? 'Tarjeta autorizada' : 'Autorizar tarjeta'}</Text>
        <Text style={styles.text}>{data.ready ? 'Tu autorización está activa. Puedes consultar las condiciones o cambiar la tarjeta.' : 'Para cancelar un evento necesitas autorizar el cobro de los costes aplicables. Guardar la tarjeta no genera una fianza.'}</Text>
        <ThemedButton title={showPolicy ? 'Ocultar condiciones' : 'Ver condiciones y autorización'} variant="outline" onPress={() => setShowPolicy(value => !value)} />
        {showPolicy && <>
        <Text style={styles.text}>{data.policy.text}</Text>
        <View style={styles.row}><Switch value={accepted} onValueChange={setAccepted} accessibilityLabel="Acepto la autorización de cobro" />
          <Text style={[styles.text, styles.flex]}>He leído y acepto esta autorización de cobro.</Text></View>
        <ThemedButton title={data.ready ? 'Cambiar tarjeta' : 'Guardar tarjeta sin fianza'} disabled={!accepted} loading={busy} onPress={() => void saveCard()} />
        </>}
      </GlassView>}
      <Text style={styles.subtitle}>Solicitudes al administrador</Text>
      {data?.requests?.map(request => <GlassView key={request.id} contentContainerStyle={styles.card}>
        <Text style={styles.subtitle}>{request.status === 'pending' ? 'Pendiente de aprobación' : request.status === 'approved' ? 'Aprobada por el administrador' : 'Rechazada: el evento no se ha cancelado'}</Text>
        <Text style={styles.text}>{getEventById(request.event_id)?.title || `Evento ${request.event_id.slice(0, 8)}`}</Text>
        <Text style={styles.text}>{request.reason}</Text>
        {!!request.review_reason && <Text style={styles.text}>Respuesta: {request.review_reason}</Text>}
        {request.status === 'pending' && <Text style={styles.caption}>El evento sigue activo. No se han iniciado devoluciones por esta solicitud.</Text>}
        <Text selectable style={styles.caption}>Referencia: {request.id}</Text>
      </GlassView>)}
      <Text style={styles.subtitle}>Cancelaciones ejecutadas y devoluciones</Text>
      {data && !data.cancellations.length && !data.requests?.length && <View style={styles.notice}>
        <Text style={styles.text}>Todavía no hay cancelaciones registradas en tu cuenta.</Text>
        {!eventId && <ThemedButton title="Ir a mis eventos" variant="outline" onPress={() => router.push('/(creator)/manage-events')} />}
      </View>}
      {data?.cancellations.map(c => <GlassView key={c.id} contentContainerStyle={styles.card}>
        <Text style={styles.eyebrow}>EVENTO CANCELADO</Text>
        <Text style={styles.subtitle}>{getEventById(c.event_id)?.title || `Evento ${c.event_id.slice(0, 8)}`}</Text>
        <Text style={styles.subtitle}>{states[c.status] || 'En revisión'}</Text><Text style={styles.text}>{c.reason}</Text>
        <Text selectable style={styles.caption}>Referencia: {c.id}</Text>
        <Text style={styles.text}>Devuelto: {euros(c.cancellation_refunds.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amount_cents, 0))}</Text>
        {c.cancellation_collections.map(payment => <View key={payment.id} style={styles.card}>
          <Text style={styles.text}>Comisión Eclipse: {euros(payment.commission_cents)}</Text>
          <Text style={styles.text}>Costes Stripe conciliados: {euros(payment.stripe_costs_cents)}</Text>
          <Text style={styles.subtitle}>Total: {euros(payment.amount_cents)}</Text>
          <Text style={styles.text}>{payment.status === 'succeeded' ? 'Cargo principal pagado' : payment.status === 'deferred' ? 'Se compensará en la próxima liquidación; no se ha cargado a la tarjeta.' : 'Cargo pendiente'}</Text>
          {payment.residual_costs_status === 'pending' ? <Text style={styles.text}>Los gastos del propio cobro están pendientes de conciliación. Se compensarán en tu siguiente liquidación, con aviso y desglose.</Text>
            : <Text style={styles.text}>Gastos reales del cobro: {euros(payment.collection_costs_cents || 0)}. Total de costes Stripe revisados: {euros(payment.reconciled_total_costs_cents || 0)}.</Text>}
          {!['succeeded','deferred'].includes(payment.status) && <ThemedButton title={`Pagar ${euros(payment.amount_cents)}`} loading={busy} onPress={() => void pay(payment.id)} />}
        </View>)}
      </GlassView>)}
      {!!data?.costs.length && <GlassView contentContainerStyle={styles.card}>
        <Text style={styles.subtitle}>Ajustes en tus liquidaciones</Text>
        <Text style={styles.text}>Los costes confirmados por Stripe se descuentan de tus próximas ganancias. Un importe negativo es saldo a tu favor. Si no hay ganancias suficientes, el saldo sigue pendiente; contacta con soporte para liquidarlo.</Text>
        {data.costs.map(cost => <View key={cost.id} style={styles.card}>
          <Text style={styles.text}>Ajuste: {euros(cost.amountCents)}</Text>
          <Text style={styles.text}>Compensado: {euros(cost.settledCents)} · Pendiente: {euros(cost.outstandingCents)}</Text>
          {cost.reservedCents !== 0 && <Text style={styles.text}>Incluido en una liquidación en curso: {euros(cost.reservedCents)}</Text>}
          {!cost.noticeAcknowledged && <ThemedButton title="He leído el ajuste" loading={busy} onPress={() => void run(async () => {
            await organizerBillingRequest(`/costs/${cost.id}/acknowledge`, {});
          })} />}
        </View>)}
      </GlassView>}
      <ThemedButton title="Actualizar estado" variant="outline" loading={busy} onPress={() => void run(async () => {})} />
    </>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: Colors.dark.background }, content: { padding: 20, gap: 18, maxWidth: 800, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, color: Colors.dark.text, fontWeight: '700' }, subtitle: { fontSize: 18, color: Colors.dark.text, fontWeight: '600' },
  text: { fontSize: 15, lineHeight: 23, color: Colors.dark.textSecondary }, card: { padding: 16, borderRadius: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1 }, error: { color: Colors.dark.error },
  input: { minHeight: 120, textAlignVertical: 'top', fontSize: 16, lineHeight: 24, padding: 12, color: Colors.dark.text, backgroundColor: Colors.dark.background, borderColor: Colors.dark.border, borderWidth: 1, borderRadius: 12 },
  hero: { gap: 12 }, icon: { width: 60, height: 60, borderRadius: 18, backgroundColor: Colors.dark.surface, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, fontWeight: '700', color: Colors.dark.primary },
  caption: { fontSize: 12, lineHeight: 18, color: Colors.dark.textSecondary },
  label: { fontSize: 15, fontWeight: '600', color: Colors.dark.text },
  notice: { padding: 16, gap: 10, borderRadius: 16, backgroundColor: Colors.dark.surface, borderWidth: 1, borderColor: Colors.dark.primary },
  warning: { padding: 16, gap: 12, borderRadius: 16, borderColor: Colors.dark.error, borderWidth: 1 },
});
