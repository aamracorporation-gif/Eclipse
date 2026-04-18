import { Stack } from 'expo-router';

export default function WorkersLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ presentation: 'modal', headerShown: false }} />
    </Stack>
  );
}
