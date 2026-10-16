import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { BillingOverview, organizerBillingRequest, organizerBillingVisible } from './organizerBilling';

/** Refresh only while visible; never apply a previous account's late response. */
export function useCancellationOverview() {
  const { user } = useAuth();
  const [data, setData] = useState<BillingOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!organizerBillingVisible || !user?.id) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const result = await organizerBillingRequest<BillingOverview>();
      if (request === generation.current) { setData(result); setError(''); }
    } catch (e) {
      if (request === generation.current) setError(e instanceof Error ? e.message : 'No se pudo actualizar el historial.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [user?.id]);
  useFocusEffect(useCallback(() => {
    setData(null);
    void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, 15000);
    return () => { ++generation.current; clearInterval(timer); subscription.remove(); };
  }, [refresh]));
  return { data, error, loading, refresh };
}
