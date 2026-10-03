import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';
import { parseAuthLinkParams } from '@/lib/authDeepLinks';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { Sparkles } from '@/lib/icons';
import { theme } from '@/theme/styles';

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
  if (role === 'admin') {
    router.replace('/(creator)');
  } else if (role === 'organizer') {
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
        const linkParams = initialUrl ? parseAuthLinkParams(initialUrl) : {};

        const code = normalized.code || linkParams.code || null;
        const accessToken = normalized.access_token || linkParams.access_token || null;
        const refreshToken = normalized.refresh_token || linkParams.refresh_token || null;
        const tokenHash = normalized.token_hash || linkParams.token_hash || null;
        const otpType = normalized.type || linkParams.type || null;

        if (tokenHash && otpType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType as any,
          });
          if (error) throw error;
        } else if (code) {
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
      <LinearGradient colors={Colors.dark.backgroundGradient} style={StyleSheet.absoluteFill} />
      <GlassView style={styles.card}>
        <View style={styles.iconContainer}>
          <Sparkles size={32} color={Colors.dark.primary} />
        </View>
        {!errorMsg ? <DiscoLoader size={72} /> : null}
        <Text style={styles.title}>{errorMsg ? 'No pudimos verificar el enlace' : 'Verificando tu cuenta…'}</Text>
        <Text style={styles.subtitle}>
          {errorMsg || 'Estamos validando tu enlace de confirmación y abriendo tu sesión.'}
        </Text>
        {errorMsg ? (
          <ThemedButton title="Volver al inicio de sesión" onPress={() => router.replace('/(auth)/login')} style={styles.button} />
        ) : null}
      </GlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.space[6],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.background,
  },
  card: { width: '100%', maxWidth: 440, alignItems: 'center' },
  iconContainer: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.dark.primarySoft, borderWidth: 1, borderColor: Colors.dark.primary, marginBottom: theme.space[5] },
  title: { color: Colors.dark.text, fontSize: theme.typography.size.xl, fontWeight: theme.typography.weight.black, textAlign: 'center', marginTop: theme.space[4] },
  subtitle: {
    marginTop: 10,
    color: Colors.dark.textSecondary,
    fontSize: theme.typography.size.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: { marginTop: theme.space[5] },
});
