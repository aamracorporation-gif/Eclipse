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

  // If not logged in or not a worker, redirect
  // Note: logic might need refinement if we want to allow normal users to mistakenly hit this URL and get redirected to home
  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!workerProfile) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
      <Stack.Screen name="sell" />
    </Stack>
  );
}
