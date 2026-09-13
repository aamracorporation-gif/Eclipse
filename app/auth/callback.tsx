import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';

function parseFragment(url: string) {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return new URLSearchParams();
  const hash = url.slice(hashIndex + 1);
  return new URLSearchParams(hash);
}

function parseQuery(url: string) {
  const qIdx = url.indexOf('?');
  if (qIdx < 0) return new URLSearchParams();
  const endIdx = url.indexOf('#', qIdx);
  const raw = endIdx > qIdx ? url.slice(qIdx + 1, endIdx) : url.slice(qIdx + 1);
  return new URLSearchParams(raw);
}

async function recordLegalNonBlocking() {
  try {
    await invokeEdgeFunctionStrict('record-legal-acceptance', {});
  } catch (e) {
    console.warn('[auth-callback] record-legal-acceptance failed (non-blocking):', e);
  }
}

async function routeByRole(uid: string) {
  let role: string | null = null;
  try {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
    role = (profile?.role as string) ?? null;
  } catch {}
  if (role === 'admin' || role === 'organizer') {
    router.replace('/(creator)/verification');
  } else {
    router.replace('/(tabs)');
  }
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
      token_hash: pick(params.token_hash),
      type: pick(params.type),
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
        const queryParams = initialUrl ? parseQuery(initialUrl) : new URLSearchParams();

        const code = normalized.code || queryParams.get('code') || fragmentParams.get('code') || null;
        const accessToken = normalized.access_token || queryParams.get('access_token') || fragmentParams.get('access_token') || null;
        const refreshToken = normalized.refresh_token || queryParams.get('refresh_token') || fragmentParams.get('refresh_token') || null;
        const tokenHash = normalized.token_hash || queryParams.get('token_hash') || fragmentParams.get('token_hash') || null;
        const otpType = normalized.type || queryParams.get('type') || fragmentParams.get('type') || null;

        let sessionCreatedOk = false;
        if (tokenHash && otpType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType as any,
          });
          if (error) throw error;
          sessionCreatedOk = true;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          sessionCreatedOk = true;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          sessionCreatedOk = true;
        } else {
          const { data: currentSession } = await supabase.auth.getSession();
          if (!currentSession.session) {
            throw new Error('No se encontró código de verificación en el enlace.');
          }
        }

        // Password recovery flow — take user to reset screen, not the app.
        if (otpType === 'recovery') {
          if (cancelled) return;
          router.replace('/auth/reset-password');
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) throw new Error('No se pudo recuperar la sesión del usuario.');

        void recordLegalNonBlocking();
        if (cancelled) return;

        await routeByRole(uid);
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

