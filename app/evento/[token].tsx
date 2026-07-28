import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/AuthContext';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';

type ResolveResult = {
  ok: boolean;
  event?: { id: string; title: string; poster_url?: string; event_date?: string | null };
  links?: { deepLink: string; webUrl: string; playStoreUrl: string | null; appStoreUrl: string | null };
  error?: string;
};

export default function SharedEventTokenScreen() {
  const { token: rawToken } = useLocalSearchParams();
  const token = String(rawToken || '');
  const { user } = useAuth();

  const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '');

  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState<string>('Abriendo evento…');
  const [deepLink, setDeepLink] = useState<string>('');
  const [storeUrl, setStoreUrl] = useState<string>('');
  const [resolvedEventId, setResolvedEventId] = useState<string>('');

  const resolveUrl = useMemo(() => {
    if (!supabaseUrl) return '';
    return `${supabaseUrl}/functions/v1/event-share/resolve?token=${encodeURIComponent(token)}`;
  }, [supabaseUrl, token]);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setStatus('error');
      setMessage('Enlace inválido.');
      return;
    }
    if (!supabaseUrl || !anonKey) {
      setStatus('error');
      setMessage('Falta configuración de Supabase.');
      return;
    }

    (async () => {
      setStatus('loading');
      try {
        const res = await fetch(resolveUrl, { method: 'GET', headers: { apikey: anonKey } });
        const text = await res.text().catch(() => '');
        let json: ResolveResult | null = null;
        try {
          json = text ? (JSON.parse(text) as ResolveResult) : null;
        } catch {
          json = null;
        }

        if (!res.ok || !json?.ok) {
          const err = String(json?.error || text || 'No se pudo abrir el enlace.');
          if (cancelled) return;
          setStatus('error');
          setMessage(
            err.includes('private')
              ? 'Este evento es privado.'
              : err.includes('expired')
              ? 'Este evento ya expiró.'
              : err.includes('cancelled')
              ? 'Este evento fue cancelado.'
              : err.includes('not found')
              ? 'Este evento ya no existe.'
              : 'No se pudo abrir el evento.'
          );
          return;
        }

        const eventId = String(json?.event?.id || '');
        const dl = String(json?.links?.deepLink || '');
        const play = json?.links?.playStoreUrl ? String(json.links.playStoreUrl) : '';
        const appStore = json?.links?.appStoreUrl ? String(json.links.appStoreUrl) : '';
        const chosenStore = Platform.OS === 'ios' ? appStore : play;

        if (!cancelled) {
          setResolvedEventId(eventId);
          setDeepLink(dl);
          setStoreUrl(chosenStore);
          setStatus('ok');
        }

        const pending = JSON.stringify({ eventId, token, at: new Date().toISOString() });
        await AsyncStorage.setItem('pending_event_share', pending);
        if (user?.id) {
          try {
            await invokeEdgeFunctionStrict('event-share', { action: 'convert', token, kind: 'open' });
            await AsyncStorage.removeItem('pending_event_share');
          } catch {}
        }

        if (Platform.OS !== 'web') {
          router.replace(`/(tabs)/event/${eventId}`);
          return;
        }

        if (dl) {
          const t0 = Date.now();
          try {
            (window as any).location.href = dl;
          } catch {}
          setTimeout(() => {
            if (chosenStore && Date.now() - t0 < 2500) {
              try {
                (window as any).location.href = chosenStore;
              } catch {}
            }
          }, 1300);
        }
      } catch {
        if (cancelled) return;
        setStatus('error');
        setMessage('No se pudo abrir el enlace.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, resolveUrl, supabaseUrl, anonKey, user?.id]);

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.container}>
        <DiscoLoader size={80} label="Abriendo…" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {status === 'loading' ? <DiscoLoader size={40} /> : null}
      <Text style={styles.title}>{status === 'error' ? 'No disponible' : 'Abrir evento'}</Text>
      <Text style={styles.text}>{message}</Text>
      {status === 'ok' && deepLink ? (
        <Pressable style={styles.button} onPress={() => ((window as any).location.href = deepLink)}>
          <Text style={styles.buttonText}>Abrir en la app</Text>
        </Pressable>
      ) : null}
      {status === 'ok' && storeUrl ? (
        <Pressable style={[styles.button, styles.secondary]} onPress={() => ((window as any).location.href = storeUrl)}>
          <Text style={styles.buttonText}>Ir a la tienda</Text>
        </Pressable>
      ) : null}
      {status === 'ok' && resolvedEventId ? (
        <Pressable style={[styles.button, styles.secondary]} onPress={() => router.replace(`/(tabs)/event/${resolvedEventId}`)}>
          <Text style={styles.buttonText}>Ver en web</Text>
        </Pressable>
      ) : null}
      {status === 'error' ? (
        <Pressable style={[styles.button, styles.secondary]} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 12,
  },
  title: {
    color: Colors.dark.text,
    fontSize: 20,
    fontWeight: '700',
  },
  text: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 420,
  },
  button: {
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.dark.primary,
    minWidth: 220,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  buttonText: {
    color: Colors.dark.text,
    fontWeight: '700',
  },
});

