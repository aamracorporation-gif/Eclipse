import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { GlassView } from './ui/GlassView';
import { ThemedButton } from './ui/ThemedButton';
import { Ban } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { organizerBillingVisible } from '@/lib/payments/organizerBilling';
import { useCancellationOverview } from '@/lib/payments/useCancellationOverview';

export function CancellationShortcut() {
  const router = useRouter();
  const { data, loading, error } = useCancellationOverview();
  if (!organizerBillingVisible) return null;
  const count = data?.cancellations.length;
  return <GlassView contentContainerStyle={{ padding: 16, gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ban size={24} color={Colors.dark.primary} />
      <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: Colors.dark.text }}>Cancelaciones</Text>
    </View>
    <Text style={{ color: Colors.dark.textSecondary, lineHeight: 22 }}>
      {error ? 'No se pudo actualizar el historial. Abre cancelaciones para reintentar.' : loading && !data
        ? 'Consultando tus cancelaciones…' : count ? `${count} cancelaciones registradas. Consulta el estado de las devoluciones y los cobros.`
          : 'Aquí encontrarás el historial de tus eventos cancelados y sus devoluciones.'}
    </Text>
    <ThemedButton title="Ver cancelaciones y devoluciones" variant="outline" onPress={() => router.push('/(creator)/cancellation-billing')} />
  </GlassView>;
}
