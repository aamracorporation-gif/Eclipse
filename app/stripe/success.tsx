import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { refreshStripeConnectStatus } from '@/lib/payments/api';
import { Colors } from '@/constants/Colors';

export default function StripeSuccessScreen() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshStripeConnectStatus();
      } catch {}
      if (!cancelled) router.replace('/(creator)/verification');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Conectando Stripe…</Text>
      <Text style={styles.subtitle}>Estamos actualizando tu estado para finalizar.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: Colors.dark.background },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  subtitle: { marginTop: 10, color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});

