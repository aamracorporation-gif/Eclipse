import { Stack, Tabs, Redirect, useSegments } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { View, Text } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { Calendar, QrCode, TrendingUp, User } from '@/lib/icons';
import { useTranslation } from 'react-i18next';

export default function CreatorLayout() {
  const { loading, user } = useAuth();
  const segments = useSegments();
  const { t } = useTranslation();
  const [checkingRole, setCheckingRole] = useState(true);
  const [profileRole, setProfileRole] = useState<string | null>(
    (user?.user_metadata as any)?.role ?? null
  );
  const [verificationStatus, setVerificationStatus] = useState<'pending_verification' | 'verified' | 'rejected' | 'needs_correction' | null>(null);
  const adminEmail = ((process.env.EXPO_PUBLIC_ADMIN_EMAIL as any) ?? '').toString().trim().toLowerCase() || 'aamracorporation@gmail.com';
  const isAdminEmail = !!user?.email && user.email.toLowerCase() === adminEmail;

  useEffect(() => {
    if (!user?.id) {
      setProfileRole(null);
      setVerificationStatus(null);
      setCheckingRole(false);
      return;
    }

    let cancelled = false;
    let channel: any = null;
    (async () => {
      setCheckingRole(true);
      try {
        const { data, error } = await supabase.from('profiles').select('role, verification_status').eq('id', user.id).maybeSingle();
        if (error) throw error;
        if (!cancelled) {
          setProfileRole((data?.role as any) ?? null);
          setVerificationStatus((data?.verification_status as any) ?? null);
        }
      } catch {
        if (!cancelled) {
          setProfileRole(null);
          setVerificationStatus(null);
        }
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();

    channel = supabase
      .channel(`creator-layout-profile-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        (payload) => {
          if (cancelled) return;
          const nextRole = (payload.new as any)?.role ?? null;
          const nextStatus = (payload.new as any)?.verification_status ?? null;
          setProfileRole(nextRole);
          setVerificationStatus(nextStatus);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
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

  if (!isAdminEmail && profileRole !== 'organizer' && profileRole !== 'admin') {
    return <Redirect href="/(tabs)" />;
  }

  const inVerification = segments?.[1] === 'verification';
  if (!isAdminEmail && profileRole === 'organizer' && verificationStatus !== 'verified' && !inVerification) {
    return <Redirect href="/(creator)/verification" />;
  }

  const isAdmin = isAdminEmail || profileRole === 'admin';
  const isVerifiedOrganizer = !isAdminEmail && profileRole === 'organizer' && verificationStatus === 'verified';

  if (isVerifiedOrganizer) {
    return (
      <Tabs
        initialRouteName="index"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#ffffff',
          tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
          tabBarStyle: {
            backgroundColor: '#050510',
            borderTopColor: 'rgba(255,255,255,0.06)',
            borderTopWidth: 1,
          },
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
        <Tabs.Screen name="verification" options={{ href: null }} />
        <Tabs.Screen name="admin-verification" options={{ href: null }} />
        <Tabs.Screen name="global-stats" options={{ href: null }} />
        <Tabs.Screen name="stats" options={{ href: null }} />
        <Tabs.Screen name="event-stats/[id]" options={{ href: null }} />
        <Tabs.Screen name="event-discounts" options={{ href: null }} />
        <Tabs.Screen name="admin-tickets" options={{ href: null }} />
        <Tabs.Screen name="worker-qr" options={{ href: null }} />
      </Tabs>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#050510' },
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-event" />
      <Stack.Screen name="manage-events" />
      <Stack.Screen name="workers" />
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
