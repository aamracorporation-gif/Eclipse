import { Stack, Tabs, Redirect, useSegments } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { AppState, View, Text } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { Calendar, QrCode, TrendingUp, User } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canAccessOrganizerPanel, CreatorAccessProfile } from '@/lib/creatorAccess';
import { theme } from '@/theme/styles';

export default function CreatorLayout() {
  const { loading, user } = useAuth();
  const segments = useSegments();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [checkingRole, setCheckingRole] = useState(true);
  const [profile, setProfile] = useState<CreatorAccessProfile | null>(null);
  const profileRole = profile?.role;
  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      setCheckingRole(false);
      return;
    }
    let cancelled = false;
    let request = 0;
    setCheckingRole(true);
    setProfile(null);
    const refresh = async () => {
      const current = ++request;
      try {
        const { data, error } = await supabase.from('profiles')
          .select('role, verification_status, stripe_account_id, stripe_onboarding_completed, stripe_charges_enabled, is_suspended')
          .eq('id', user.id).maybeSingle();
        if (error) throw error;
        if (!cancelled && current === request) setProfile(data);
      } catch {
        if (!cancelled && current === request) setProfile(null);
      } finally {
        if (!cancelled && current === request) setCheckingRole(false);
      }
    };
    void refresh();
    const channel = supabase.channel(`creator-layout-profile-${user.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        () => { void refresh(); })
      .subscribe();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    // Recover changes when Realtime is unavailable (including browser onboarding).
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  if (loading || checkingRole) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.dark.background }}>
        <DiscoLoader size={140} />
      </View>
    );
  }

  if (!user) {
    return (
      <Redirect
        href={{
          pathname: '/auth-required',
          params: { titleKey: 'auth.login', subtitleKey: 'profile.sign_in_prompt' },
        } as any}
      />
    );
  }

  if (profile?.is_suspended || (profileRole !== 'organizer' && profileRole !== 'admin')) {
    return <Redirect href="/(tabs)" />;
  }

  const inVerification = (segments as readonly string[])[1] === 'verification';
  if (profileRole === 'organizer' && !canAccessOrganizerPanel(profile) && !inVerification) {
    return <Redirect href="/(creator)/verification" />;
  }

  const adminOnlyRoutes = ['admin-verification', 'admin-tickets', 'admin-profile'];
  if (profileRole !== 'admin' && adminOnlyRoutes.includes((segments as readonly string[])[1])) {
    return <Redirect href="/(creator)" />;
  }
  if ((profileRole === 'admin' || canAccessOrganizerPanel(profile)) && inVerification) return <Redirect href="/(creator)" />;

  const isVerifiedOrganizer = canAccessOrganizerPanel(profile);

  if (profileRole === 'admin') {
    return (
      <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: Colors.dark.primary,
        tabBarInactiveTintColor: Colors.dark.textSecondary,
        tabBarStyle: { backgroundColor: Colors.dark.background, borderTopColor: Colors.dark.border,
          height: 60 + insets.bottom, paddingBottom: Math.max(insets.bottom, 8) },
        tabBarLabelStyle: { fontSize: 10 }, tabBarHideOnKeyboard: true }}>
        <Tabs.Screen name="index" options={{ title: 'Resumen', tabBarIcon: ({ color, size }) => <TrendingUp color={color} size={size} /> }} />
        <Tabs.Screen name="admin-verification" options={{ title: 'Usuarios', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
        <Tabs.Screen name="manage-events" options={{ title: 'Eventos', tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} /> }} />
        <Tabs.Screen name="admin-tickets" options={{ title: 'Entradas', tabBarIcon: ({ color, size }) => <QrCode color={color} size={size} /> }} />
        <Tabs.Screen name="admin-profile" options={{ title: 'Perfil', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
        {['create-event', 'workers', 'verification', 'scan', 'stats', 'global-stats', 'event-stats/[id]',
          'event-discounts', 'discount-codes', 'worker-qr', 'organizer-profile', 'box-office'].map(name => (
          <Tabs.Screen key={name} name={name} options={{ href: null }} />
        ))}
      </Tabs>
    );
  }

  if (isVerifiedOrganizer) {
    return (
      <Tabs
        initialRouteName="index"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.dark.primary,
          tabBarInactiveTintColor: Colors.dark.textSecondary,
          tabBarStyle: {
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 0,
            height: 56 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom + 6,
            borderRadius: theme.radius.lg,
            backgroundColor: Colors.dark.surfaceStrong,
            borderColor: Colors.dark.border,
            borderWidth: 1,
            elevation: 12,
          },
          tabBarHideOnKeyboard: true,
          tabBarLabelStyle: { paddingBottom: 2, fontSize: 10, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('creator.tabs.stats', { defaultValue: 'Estadísticas' }),
            tabBarIcon: ({ color, size }) => <TrendingUp color={color} size={size ?? 22} />,
          }}
        />
        <Tabs.Screen
          name="manage-events"
          options={{
            title: t('creator.manage_events.title_organizer', { defaultValue: 'Mis eventos' }),
            tabBarIcon: ({ color, size }) => <Calendar color={color} size={size ?? 22} />,
          }}
        />
        <Tabs.Screen
          name="scan"
          options={{
            title: t('creator.scan.title', { defaultValue: 'Acceso' }),
            tabBarIcon: ({ color, size }) => <QrCode color={color} size={size ?? 22} />,
          }}
        />
        <Tabs.Screen
          name="discount-codes"
          options={{
            title: 'Descuentos',
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 18, fontWeight: '900', lineHeight: 22 }}>%</Text>
            ),
          }}
        />
        <Tabs.Screen
          name="organizer-profile"
          options={{
            title: t('tabs.profile'),
            tabBarIcon: ({ color, size }) => <User color={color} size={size ?? 22} />,
          }}
        />

        <Tabs.Screen name="create-event" options={{ href: null }} />
        <Tabs.Screen name="workers" options={{ href: null }} />
        <Tabs.Screen name="box-office" options={{ href: null }} />
        <Tabs.Screen name="verification" options={{ href: null }} />
        <Tabs.Screen name="admin-verification" options={{ href: null }} />
        <Tabs.Screen name="global-stats" options={{ href: null }} />
        <Tabs.Screen name="stats" options={{ href: null }} />
        <Tabs.Screen name="event-stats/[id]" options={{ href: null }} />
        <Tabs.Screen name="event-discounts" options={{ href: null }} />
        <Tabs.Screen name="admin-tickets" options={{ href: null }} />
        <Tabs.Screen name="admin-profile" options={{ href: null }} />
        <Tabs.Screen name="worker-qr" options={{ href: null }} />
      </Tabs>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.dark.background },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-event" />
      <Stack.Screen name="manage-events" />
      <Stack.Screen name="workers" />
      <Stack.Screen name="box-office" />
      <Stack.Screen name="verification" />
      <Stack.Screen name="admin-verification" />
      <Stack.Screen name="scan" />
      <Stack.Screen name="stats" />
      <Stack.Screen name="event-stats/[id]" />
      <Stack.Screen name="admin-tickets" />
      <Stack.Screen name="event-discounts" />
      <Stack.Screen name="worker-qr" />
    </Stack>
  );
}
