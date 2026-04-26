import 'react-native-url-polyfill/auto';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
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

function RootLayoutNav({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { loading, user } = useAuth();
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
    <StripeProvider>
      <EventProvider>
        <CreditProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: {
                backgroundColor: '#0F0F1A',
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
      <SafeAreaProvider>
        <DiscoLoader fullScreen size={160} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <I18nProvider>
          <NotificationProvider>
            <RootLayoutNav fontsLoaded={fontsLoaded} />
          </NotificationProvider>
        </I18nProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
