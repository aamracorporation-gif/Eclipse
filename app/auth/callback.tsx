import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';

function parseFragment(url: string) {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return new URLSearchParams();
  const hash = url.slice(hashIndex + 1);
  return new URLSearchParams(hash);
}

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const normalized = useMemo(() => {
    const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
    return {
      code: pick(params.code),
      access_token: pick(params.access_token),
      refresh_token: pick(params.refresh_token),
      error_description: pick(params.error_description),
      error: pick(params.error),
    };
  }, [params]);

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      try {
        if (normalized.error || normalized.error_description) {
          throw new Error(normalized.error_description || normalized.error || 'No se pudo verificar el email.');
        }

        const initialUrl = await Linking.getInitialURL();
        const fragmentParams = initialUrl ? parseFragment(initialUrl) : new URLSearchParams();

        const code = normalized.code || fragmentParams.get('code') || null;
        const accessToken = normalized.access_token || fragmentParams.get('access_token') || null;
        const refreshToken = normalized.refresh_token || fragmentParams.get('refresh_token') || null;

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          const { data: currentSession } = await supabase.auth.getSession();
          if (!currentSession.session) {
            throw new Error('No se encontró código de verificación en el enlace.');
          }
        }

        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) throw new Error('No se pudo recuperar la sesión del usuario.');

        const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
        if (cancelled) return;

        if (profile?.role === 'organizer') {
          router.replace('/(creator)/verification');
        } else {
          router.replace('/(tabs)');
        }
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(String(e?.message || 'No se pudo completar la verificación.'));
      }
    };

    finish();
    return () => {
      cancelled = true;
    };
  }, [normalized]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verificando tu cuenta...</Text>
      <Text style={styles.subtitle}>
        {errorMsg || 'Estamos validando tu enlace de confirmación y abriendo tu sesión.'}
      </Text>
      {errorMsg ? (
        <Text style={styles.link} onPress={() => router.replace('/(auth)/login')}>
          Volver al login
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.background,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  subtitle: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  link: { marginTop: 16, color: Colors.dark.primary, fontWeight: '700' },
});

