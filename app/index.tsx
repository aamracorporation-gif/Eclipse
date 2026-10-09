import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { View } from 'react-native';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { Colors } from '@/constants/Colors';

export default function Index() {
  const { session, loading, user } = useAuth();
  const [resolvedHref, setResolvedHref] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;

    if (!session || !user?.id) {
      setResolvedHref('/(tabs)');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (error) throw error;
        const role = (data?.role as any) ?? null;
        if (cancelled) return;
        if (role === 'admin') setResolvedHref('/(creator)');
        else if (role === 'organizer') setResolvedHref('/(creator)');
        else setResolvedHref('/(tabs)');
      } catch {
        if (!cancelled) setResolvedHref('/(tabs)');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, session, user?.id]);

  if (loading || !resolvedHref) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background }}>
        <DiscoLoader size={120} />
      </View>
    );
  }

  return <Redirect href={resolvedHref as any} />;
}
