import { Stack, useSegments } from 'expo-router';
import { useBoxOfficeAccess } from '@/hooks/useBoxOfficeAccess';
import { useAuth } from '@/lib/AuthContext';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { Colors } from '@/constants/Colors';
import { DiscoLoader } from '@/components/ui/DiscoLoader';

export default function WorkerLayout() {
  const { user, workerProfile, loading } = useAuth();
  const segments = useSegments();
  const boxOffice = useBoxOfficeAccess(workerProfile?.organizer_id);
  const selling = (segments as readonly string[])[1] === 'sell';

  if (loading || (selling && boxOffice.checking)) {
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

  if (!workerProfile) {
    return <Redirect href="/(tabs)" />;
  }

  if (selling && !boxOffice.can_sell) return <Redirect href="/(worker)" />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: Colors.dark.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
      <Stack.Screen name="sell" />
    </Stack>
  );
}
