import 'react-native-url-polyfill/auto';
import { Component, type ReactNode, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
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
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import * as Notifications from 'expo-notifications';
import * as ExpoLinking from 'expo-linking';

// Configure notifications handler globally
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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

    const handleUrl = (url: string | null | undefined) => {
      if (!url) return;
      const parsed = ExpoLinking.parse(url);
      const path = (parsed?.path || '').replace(/^\/+/, '');
      if (!path) return;

      if (path.startsWith('event/')) {
        const eventId = path.split('/')[1];
        if (eventId) router.push(`/(tabs)/event/${eventId}`);
      }
    };

    ExpoLinking.getInitialURL().then(handleUrl);
    const sub = ExpoLinking.addEventListener('url', (event) => handleUrl(event.url));
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

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void initLanguage();
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
                <RootLayoutNav fontsLoaded={fontsLoaded} />
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
