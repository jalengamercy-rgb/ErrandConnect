import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back', headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'ErrandCONNECT' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="verify-email" options={{ title: 'Verify email' }} />
      <Stack.Screen name="emergency-contact" options={{ title: 'Emergency contact' }} />
      <Stack.Screen name="addresses/index" options={{ title: 'Saved addresses' }} />
      <Stack.Screen name="addresses/new" options={{ title: 'Add address' }} />
      <Stack.Screen name="runner/onboarding" options={{ title: 'Runner registration' }} />
      <Stack.Screen name="runner/[step]" options={{ title: '' }} />
    </Stack>
  );
}
