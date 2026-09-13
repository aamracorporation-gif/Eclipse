import { Stack } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { Colors } from '@/constants/Colors';
import { DiscoLoader } from '@/components/ui/DiscoLoader';

export default function WorkerLayout() {
  const { user, workerProfile, loading } = useAuth();

  if (loading) {
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

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: Colors.dark.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
      <Stack.Screen name="sell" />
    </Stack>
  );
}
