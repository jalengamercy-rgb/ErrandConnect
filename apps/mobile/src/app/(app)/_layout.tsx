import { Stack } from 'expo-router';

import { useAuth } from '@/lib/auth-context';
import { useRunnerLocationReporting } from '@/lib/orders';
import { useRealtime } from '@/lib/realtime';

export default function AppLayout() {
  const { me } = useAuth();
  useRealtime(!!me);
  useRunnerLocationReporting(me?.runnerProfile?.isOnline === true);

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
      <Stack.Screen name="orders/index" options={{ title: 'My errands' }} />
      <Stack.Screen name="orders/new" options={{ title: 'New errand' }} />
      <Stack.Screen name="orders/[id]/index" options={{ title: 'Errand' }} />
      <Stack.Screen name="orders/[id]/chat" options={{ title: 'Chat' }} />
      <Stack.Screen name="jobs" options={{ title: 'Available jobs' }} />
      <Stack.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="support/index" options={{ title: 'Help & support' }} />
      <Stack.Screen name="support/[id]" options={{ title: 'Support' }} />
      <Stack.Screen name="business/index" options={{ title: 'Company accounts' }} />
      <Stack.Screen name="business/register" options={{ title: 'Register a company' }} />
      <Stack.Screen name="business/[id]/index" options={{ title: 'Company' }} />
      <Stack.Screen name="business/[id]/orders" options={{ title: 'Company errands' }} />
      <Stack.Screen name="invoices" options={{ title: 'Invoices' }} />
      <Stack.Screen name="rewards" options={{ title: 'Rewards' }} />
      <Stack.Screen name="plus" options={{ title: 'ErrandCONNECT Plus' }} />
      <Stack.Screen name="account" options={{ title: 'Privacy & account' }} />
      <Stack.Screen name="shops/index" options={{ title: 'Shops' }} />
      <Stack.Screen name="shop/index" options={{ title: 'My shop' }} />
      <Stack.Screen name="shop/register" options={{ title: 'List your shop' }} />
      <Stack.Screen name="shop/[id]" options={{ title: 'Shop dashboard' }} />
    </Stack>
  );
}
