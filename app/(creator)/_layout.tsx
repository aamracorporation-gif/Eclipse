import { Stack, Redirect, useSegments } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { View } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DiscoLoader } from '@/components/ui/DiscoLoader';

export default function CreatorLayout() {
  const { loading, user } = useAuth();
  const segments = useSegments();
  const [checkingRole, setCheckingRole] = useState(true);
  const [profileRole, setProfileRole] = useState<string | null>(null);
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
    return <Redirect href="/(auth)/login" />;
  }

  if (!isAdminEmail && profileRole !== 'organizer' && profileRole !== 'admin') {
    return <Redirect href="/(tabs)" />;
  }

  const inVerification = segments?.[1] === 'verification';
  if (!isAdminEmail && profileRole === 'organizer' && verificationStatus !== 'verified' && !inVerification) {
    return <Redirect href="/(creator)/verification" />;
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
    </Stack>
  );
}
