import 'react-native-url-polyfill/auto';
import { Component, type ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { EventProvider } from '@/lib/EventContext';
import { CreditProvider } from '@/lib/WalletContext';
import { NotificationProvider } from '@/lib/NotificationContext';
import { I18nProvider } from '@/lib/I18nContext';
import { StripeProvider } from '@/lib/payments/StripeProvider';
import { initLanguage } from '@/lib/i18n';
import { useTranslation } from 'react-i18next';
import { useFonts, PermanentMarker_400Regular } from '@expo-google-fonts/permanent-marker';
import { RussoOne_400Regular } from '@expo-google-fonts/russo-one';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { initNotifications } from '@/lib/notifications';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { AppDialogProvider } from '@/components/ui/AppDialog';
import { FilterProvider } from '@/lib/FilterContext';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from '@/lib/supabase';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';

import * as Notifications from 'expo-notifications';
import * as ExpoLinking from 'expo-linking';

// Notification handler set via initNotifications() after app is ready

// ── Offline detection ─────────────────────────────────────────────────────────
const PING_URL = 'https://connectivitycheck.gstatic.com/generate_204';
const PING_INTERVAL_MS = 6000;
const PING_TIMEOUT_MS = 4000;
const OFFLINE_GRACE_MS = 30_000; // wait 30 s before showing the offline screen

async function checkOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch(PING_URL, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

function OfflineGuard({ children }: { children: ReactNode }) {
  // `showOffline` = the card is actually visible after the grace period
  const [showOffline, setShowOffline] = useState(false);
  // `countdown` = seconds remaining in the grace period (shown while waiting)
  const [countdown, setCountdown] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineSinceRef = useRef<number | null>(null);

  const clearGrace = () => {
    if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    offlineSinceRef.current = null;
    setCountdown(0);
  };

  const ping = async () => {
    const online = await checkOnline();

    if (online) {
      // Back online — cancel everything and hide the screen
      clearGrace();
      setShowOffline(false);
      return;
    }

    // Already showing the offline card — nothing more to do
    if (showOffline) return;

    // First failed ping — start the 30-second grace period
    if (offlineSinceRef.current === null) {
      offlineSinceRef.current = Date.now();

      let secs = Math.ceil(OFFLINE_GRACE_MS / 1000);
      setCountdown(secs);
      countdownRef.current = setInterval(() => {
        secs -= 1;
        setCountdown(secs > 0 ? secs : 0);
      }, 1000);

      graceTimerRef.current = setTimeout(() => {
        clearGrace();
        setShowOffline(true);
      }, OFFLINE_GRACE_MS);
    }
  };

  useEffect(() => {
    ping();
    intervalRef.current = setInterval(ping, PING_INTERVAL_MS);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') ping();
    });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearGrace();
      sub.remove();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {children}

      {/* Grace-period loader — shown while we wait the 30 s */}
      <Modal visible={countdown > 0} transparent animationType="fade" statusBarTranslucent>
        <View style={offlineStyles.backdrop}>
          <View style={offlineStyles.card}>
            <DiscoLoader size={80} />
            <Text style={[offlineStyles.title, { marginTop: 22 }]}>Conectando…</Text>
            <Text style={offlineStyles.body}>
              Buscando conexión a internet.{'\n'}Si el problema persiste, comprueba tu WiFi o datos móviles.
            </Text>
            <View style={offlineStyles.countdown}>
              <Text style={offlineStyles.countdownText}>{countdown}s</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Offline card — shown after the 30 s grace period */}
      <Modal visible={showOffline} transparent animationType="fade" statusBarTranslucent>
        <View style={offlineStyles.backdrop}>
          <View style={offlineStyles.card}>
            <Text style={offlineStyles.icon}>📡</Text>
            <Text style={offlineStyles.title}>Sin conexión a internet</Text>
            <Text style={offlineStyles.body}>
              Esta app requiere conexión a internet para funcionar correctamente. Comprueba tu WiFi o datos móviles e inténtalo de nuevo.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const offlineStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    width: '100%',
    maxWidth: 360,
  },
  icon: { fontSize: 48, marginBottom: 14 },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  body: { color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  countdown: {
    marginTop: 18,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: { color: 'rgba(255,255,255,0.60)', fontSize: 16, fontWeight: '800' },
});

// ─────────────────────────────────────────────────────────────────────────────

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, info: any) {
    try {
      console.error('[AppErrorBoundary]', error, info);
    } catch {}
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={errorStyles.container}>
        <View style={StyleSheet.absoluteFill} />
        <View style={errorStyles.center}>
          <GlassView intensity={18} style={errorStyles.card}>
            <Text style={errorStyles.title}>Algo salió mal</Text>
            <Text style={errorStyles.body}>
              La app encontró un error inesperado. Puedes volver a cargar la pantalla principal.
            </Text>
            <ThemedButton
              title="Reiniciar"
              onPress={() => {
                this.setState({ hasError: false });
                router.replace('/(tabs)');
              }}
              style={{ marginTop: 14 }}
            />
          </GlassView>
        </View>
      </View>
    );
  }
}

function RootLayoutNav({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { loading } = useAuth();
  const { t } = useTranslation();
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    const errorUtils = (global as any)?.ErrorUtils;
    const prevHandler = errorUtils?.getGlobalHandler?.();
    if (errorUtils?.setGlobalHandler) {
      errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        try {
          console.error('[GlobalError]', { isFatal: !!isFatal, message: error?.message, stack: error?.stack });
        } catch {}
        if (typeof prevHandler === 'function') {
          try {
            prevHandler(error, isFatal);
          } catch {}
        }
      });
    }

    const prevRejection = (globalThis as any).onunhandledrejection;
    (globalThis as any).onunhandledrejection = (event: any) => {
      try {
        console.error('[UnhandledRejection]', event?.reason || event);
      } catch {}
      if (typeof prevRejection === 'function') {
        try {
          prevRejection(event);
        } catch {}
      }
    };

    return () => {
      if (errorUtils?.setGlobalHandler && typeof prevHandler === 'function') {
        try {
          errorUtils.setGlobalHandler(prevHandler);
        } catch {}
      }
      (globalThis as any).onunhandledrejection = prevRejection;
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded && !loading) {
      setIsAppReady(true);
    }
  }, [fontsLoaded, loading]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAppReady(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isAppReady) return;

    const afterAuthRedirect = async () => {
      try {
        void (async () => {
          try {
            await invokeEdgeFunctionStrict('record-legal-acceptance', {});
          } catch (e) {
            console.warn('[linking] record-legal-acceptance failed (non-blocking):', e);
          }
        })();

        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        let role: string | null = null;
        if (uid) {
          try {
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
            role = (profile?.role as string) ?? null;
          } catch {}
        }
        if (role === 'admin' || role === 'organizer') {
          router.replace('/(creator)/verification');
        } else {
          router.replace('/(tabs)');
        }
      } catch (e) {
        console.warn('[linking] afterAuthRedirect fallback to /(tabs):', e);
        router.replace('/(tabs)');
      }
    };

    const handleUrl = async (url: string | null | undefined) => {
      if (!url) return;

      if (url.includes('auth/reset-password')) {
        try {
          const parsed = ExpoLinking.parse(url);
          const qp = (parsed.queryParams as Record<string, string>) ?? {};
          router.push({ pathname: '/auth/reset-password', params: qp });
        } catch (e) {
          console.warn('[linking] auth/reset-password error:', e);
        }
        return;
      }

      if (url.includes('auth/callback')) {
        try {
          const parsed = ExpoLinking.parse(url);
          const queryParams = (parsed.queryParams as Record<string, string>) ?? {};

          let hashParams: Record<string, string> = {};
          try {
            const hashIdx = url.indexOf('#');
            if (hashIdx >= 0) {
              const raw = url.slice(hashIdx + 1);
              for (const kv of raw.split('&')) {
                const [k, ...rest] = kv.split('=');
                if (k) hashParams[decodeURIComponent(k)] = decodeURIComponent(rest.join('='));
              }
            }
          } catch {}

          const params = { ...hashParams, ...queryParams };

          const tokenHash = params.token_hash;
          const otpType = params.type;
          if (tokenHash && otpType) {
            const { data, error } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: otpType as any,
            });
            if (!error && data?.session) {
              await afterAuthRedirect();
            } else if (error) {
              console.warn('[linking] verifyOtp failed:', error?.message);
            }
            return;
          }

          const accessToken = params.access_token;
          const refreshToken = params.refresh_token;
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!error) {
              await afterAuthRedirect();
            } else {
              console.warn('[linking] setSession failed:', error?.message);
            }
            return;
          }
        } catch (e) {
          console.warn('[linking] auth/callback handled with error:', e);
        }
        return;
      }

      const parsed = ExpoLinking.parse(url);
      const path = (parsed?.path || '').replace(/^\/+/, '');
      if (!path) return;

      const match = path.replace(/^\/+/, '').match(/(^|\/)event\/([^/?#]+)/i);
      if (match?.[2]) {
        router.push(`/(tabs)/event/${match[2]}`);
        return;
      }

      const eventoMatch = path.match(/^evento\/([^/?#]+)$/i);
      if (eventoMatch?.[1]) {
        router.push(`/evento/${eventoMatch[1]}`);
      }
    };

    ExpoLinking.getInitialURL().then(handleUrl);
    const sub = ExpoLinking.addEventListener('url', (event) => handleUrl(event.url));
    return () => sub.remove();
  }, [isAppReady]);

  useEffect(() => {
    if (!isAppReady) return;

    const navigateFromNotification = (data: any) => {
      const type = String(data?.type || data?.tipo || '');

      // Organizer notifications → creator panel
      const organizerTypes = [
        'organizer_new_sale', 'organizer_realtime_sale', 'organizer_verified', 'organizer_rejected',
        'stock_alerts', 'realtime_sales', 'daily_summary', 'new_sale',
        'stock_low', 'organizer_weekly_recap',
      ];
      if (organizerTypes.some(t => type.includes(t))) {
        router.push('/(creator)/' as any);
        return;
      }

      // Purchase / ticket / validation → tickets screen
      const ticketTypes = [
        'purchase_confirmed', 'purchase_completed', 'purchase_fulfilled',
        'ticket_validated', 'ticket_cancelled', 'ticket_upgraded',
        'event_reminder_24h', 'event_reminder_1h',
        'compra_entrada', 'compra_vip', 'entrada_validada',
        'event_almost_full',
      ];
      if (ticketTypes.some(t => type.includes(t))) {
        router.push('/(tabs)/tickets' as any);
        return;
      }

      // Resale notifications → resale screen
      const resaleTypes = ['resale_sold', 'resale_purchased', 'resale_update', 'resale_purchase', 'compra_reventa'];
      if (resaleTypes.some(t => type.includes(t))) {
        router.push('/(tabs)/resale' as any);
        return;
      }

      // Event-related → event detail
      const eventId = String(data?.eventId || data?.event_id || '');
      if (eventId) {
        router.push(`/(tabs)/event/${eventId}` as any);
        return;
      }

      const urlRaw = String(data?.url || data?.event_url || data?.link || '');
      const url = urlRaw.trim();
      if (!url) return;

      const cleaned = url.replace(/^\/+/, '');
      const match = cleaned.match(/(^|\/)event\/([^/?#]+)/i);
      if (match?.[2]) {
        router.push(`/(tabs)/event/${match[2]}` as any);
        return;
      }

      if (cleaned.startsWith('(tabs)/') || cleaned.startsWith('(creator)/') || cleaned.startsWith('(auth)/')) {
        router.push(`/${cleaned}` as any);
      }
    };

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const data = (response as any)?.notification?.request?.content?.data;
        if (data) navigateFromNotification(data);
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response as any)?.notification?.request?.content?.data;
      if (data) navigateFromNotification(data);
    });

    return () => sub.remove();
  }, [isAppReady]);

  if (!isAppReady) {
    return (
      <DiscoLoader
        fullScreen
        label={t('common.app_loading_title')}
        subLabel={t('common.app_loading_subtitle')}
        size={160}
      />
    );
  }

  return (
    <AppErrorBoundary>
      <StripeProvider>
        <FilterProvider>
        <EventProvider>
          <CreditProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: {
                  backgroundColor: Colors.dark.background,
                },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
              <Stack.Screen name="auth/reset-password" options={{ headerShown: false }} />
              <Stack.Screen name="(creator)" options={{ headerShown: false }} />
              <Stack.Screen name="(worker)" options={{ headerShown: false }} />
              <Stack.Screen 
                name="notifications" 
                options={{ 
                  headerShown: false,
                  presentation: 'modal'
                }} 
              />
              <Stack.Screen name="+not-found" />
            </Stack>
            <StatusBar style="light" />
          </CreditProvider>
        </EventProvider>
        </FilterProvider>
      </StripeProvider>
    </AppErrorBoundary>
  );
}

export default function RootLayout() {
  useFrameworkReady();
  const [fontsLoaded] = useFonts({
    PermanentMarker_400Regular,
    RussoOne_400Regular,
  });
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    const ErrorUtilsAny = (globalThis as any)?.ErrorUtils;
    const prevHandler = ErrorUtilsAny?.getGlobalHandler?.();
    if (ErrorUtilsAny?.setGlobalHandler) {
      ErrorUtilsAny.setGlobalHandler((error: any, isFatal: boolean) => {
        try {
          console.error('[GlobalErrorHandler]', { isFatal, error });
        } catch {}
        if (typeof prevHandler === 'function') {
          try {
            prevHandler(error, isFatal);
          } catch {}
        }
      });
    }
    return () => {
      try {
        if (ErrorUtilsAny?.setGlobalHandler && typeof prevHandler === 'function') {
          ErrorUtilsAny.setGlobalHandler(prevHandler);
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initNotifications();
        await initLanguage();
      } finally {
        if (mounted) setI18nReady(true);
      }
    })();

    const dispatchPending = () => {
      supabase.functions.invoke('dispatch-notifications', { body: { limit: 100 } }).catch(() => {});
    };

    dispatchPending();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void initLanguage();
        dispatchPending();
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  if (!i18nReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <DiscoLoader fullScreen size={160} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <I18nProvider>
            <NotificationProvider>
              <AppDialogProvider>
                <OfflineGuard>
                  <RootLayoutNav fontsLoaded={fontsLoaded} />
                </OfflineGuard>
              </AppDialogProvider>
            </NotificationProvider>
          </I18nProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  card: {
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
  },
  title: { color: Colors.dark.text, fontWeight: '900', fontSize: 18 },
  body: { marginTop: 10, color: Colors.dark.textSecondary, fontWeight: '700', lineHeight: 20 },
});
