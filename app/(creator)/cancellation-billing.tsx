import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useOrganizerStripe } from '@/lib/payments/useOrganizerStripe';
import * as Linking from 'expo-linking';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { BillingOverview, organizerBillingRequest, organizerBillingVisible } from '@/lib/payments/organizerBilling';

const euros = (value: number) => `${(value / 100).toFixed(2).replace('.', ',')} €`;
const states: Record<string, string> = { refunding: 'Devoluciones en curso', reconciliation: 'Calculando costes reales',
  collection_pending: 'Desglose disponible', requires_action: 'Pago pendiente de completar', collected: 'Devoluciones completadas', attention: 'En revisión' };

export default function CancellationBillingScreen() {
  const router = useRouter();
  const { event_id: eventId } = useLocalSearchParams<{ event_id?: string }>();
  const stripe = useOrganizerStripe();
  const [data, setData] = useState<BillingOverview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const refresh = useCallback(async () => {
    if (!organizerBillingVisible) return;
    const result = await organizerBillingRequest<BillingOverview>();
    setData(result); setError('');
  }, []);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
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
  const cancel = () => Alert.alert('Cancelar el evento',
    'Se detendrán las ventas, se invalidarán las entradas y se tramitará la devolución íntegra. Después se te cobrará la comisión de Eclipse y los costes reales de Stripe, con su desglose. Esta acción no se puede deshacer.', [
      { text: 'Volver', style: 'cancel' }, { text: 'Cancelar evento', style: 'destructive', onPress: () => void run(async () => {
        await organizerBillingRequest(`/events/${eventId}/cancel`, { reason: reason.trim() });
        setReason('');
      }) },
    ]);
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
  const existing = data?.cancellations.some(c => c.event_id === eventId);
  return <SafeAreaView style={styles.screen}><ScrollView contentContainerStyle={styles.content}>
    <ThemedButton title="Volver" variant="outline" onPress={() => router.back()} />
    <Text style={styles.title}>Cancelaciones y cobros</Text>
    {!organizerBillingVisible ? <Text style={styles.text}>Esta función todavía no está disponible.</Text> : <>
      <Text style={styles.text}>Sin fianza inicial. El comprador recupera todo su pago si cancelas. Tus ganancias se liquidan después del evento.</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {data && <GlassView style={styles.card}>
        <Text style={styles.subtitle}>{data.ready ? 'Tarjeta autorizada' : 'Autorizar tarjeta'}</Text>
        <Text style={styles.text}>{data.policy.text}</Text>
        <View style={styles.row}><Switch value={accepted} onValueChange={setAccepted} accessibilityLabel="Acepto la autorización de cobro" />
          <Text style={[styles.text, styles.flex]}>He leído y acepto esta autorización de cobro.</Text></View>
        <ThemedButton title={data.ready ? 'Cambiar tarjeta' : 'Guardar tarjeta sin fianza'} disabled={!accepted} loading={busy} onPress={() => void saveCard()} />
      </GlassView>}
      {eventId && !existing && <GlassView style={styles.card}>
        <Text style={styles.subtitle}>Solicitar cancelación</Text>
        <TextInput value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Motivo de la cancelación" placeholderTextColor={Colors.dark.textSecondary} style={styles.input} />
        <ThemedButton title="Revisar cancelación" disabled={!data?.ready || reason.trim().length < 3} loading={busy} onPress={cancel} />
      </GlassView>}
      {data?.cancellations.map(c => <GlassView key={c.id} style={styles.card}>
        <Text style={styles.subtitle}>{states[c.status] || 'En revisión'}</Text><Text style={styles.text}>{c.reason}</Text>
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
      {!!data?.costs.length && <GlassView style={styles.card}>
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
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: Colors.dark.background }, content: { padding: 20, gap: 18, maxWidth: 800, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, color: Colors.dark.text, fontWeight: '700' }, subtitle: { fontSize: 18, color: Colors.dark.text, fontWeight: '600' },
  text: { fontSize: 15, lineHeight: 23, color: Colors.dark.textSecondary }, card: { padding: 16, borderRadius: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1 }, error: { color: Colors.dark.error },
  input: { minHeight: 100, padding: 12, color: Colors.dark.text, borderColor: Colors.dark.textSecondary, borderWidth: 1, borderRadius: 12 },
});
