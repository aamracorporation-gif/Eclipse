import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase';

export type BoxOfficeAccess = {
  enabled: boolean; can_sell: boolean; status: string;
  paid_through: string | null; cancel_at_period_end: boolean;
};
const EMPTY: BoxOfficeAccess = { enabled: false, can_sell: false, status: 'inactive', paid_through: null, cancel_at_period_end: false };

export function useBoxOfficeAccess(organizerId?: string | null) {
  const [result, setResult] = useState<{ organizerId: string; access: BoxOfficeAccess } | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    if (!organizerId) { setResult(null); setChecking(false); return; }
    try {
      const { data, error: queryError } = await supabase.rpc('get_box_office_access', { p_organizer_id: organizerId });
      if (queryError) throw queryError;
      if (sequence.current === seq) { setResult({ organizerId, access: data }); setError(''); }
    } catch {
      if (sequence.current === seq) { setResult(null); setError('No se pudo comprobar Taquilla Premium. El escáner sigue disponible.'); }
    } finally { if (sequence.current === seq) setChecking(false); }
  }, [organizerId]);
  useFocusEffect(useCallback(() => {
    setChecking(true); void refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 15000);
    return () => { ++sequence.current; subscription.remove(); clearInterval(timer); };
  }, [refresh]));
  const access = result && result.organizerId === organizerId ? result.access : EMPTY;
  useEffect(() => {
    if (!access.paid_through) return;
    const remaining = new Date(access.paid_through).getTime() - Date.now();
    if (remaining <= 0 || remaining > 2147483647) return;
    const timer = setTimeout(() => { void refresh(); }, remaining + 50);
    return () => clearTimeout(timer);
  }, [access.paid_through, refresh]);
  const valid = access.enabled && !!access.paid_through && new Date(access.paid_through).getTime() > Date.now();
  return { ...access, enabled: valid, can_sell: valid && access.can_sell === true, checking, error, refresh };
}
