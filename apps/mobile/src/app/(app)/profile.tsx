import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { api } from '@/lib/api';
import { ME_QUERY_KEY, useAuth } from '@/lib/auth-context';

const LEVELS: Record<number, string> = {
  1: 'Level 1 · Phone verified',
  2: 'Level 2 · Email verified',
  3: '🟢 Verified Customer (ID checked)',
};

export default function ProfileScreen() {
  const { me, signOut } = useAuth();
  const queryClient = useQueryClient();
  const addRole = useMutation({
    mutationFn: (role: 'customer' | 'runner') => api.post(`/me/roles/${role}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
  if (!me) return null;

  return (
    <Screen>
      <Card>
        <ThemedText type="subtitle">
          {me.firstName} {me.lastName}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{me.phone}</ThemedText>
        {me.email && (
          <ThemedText themeColor="textSecondary">
            {me.email} {me.emailVerifiedAt ? '✓' : '(not verified)'}
          </ThemedText>
        )}
        {me.customerProfile && (
          <>
            <ThemedText type="small">Customer ID: {me.customerProfile.customerCode}</ThemedText>
            <ThemedText type="smallBold">{LEVELS[me.customerProfile.verificationLevel]}</ThemedText>
          </>
        )}
        {me.runnerProfile && <ThemedText type="small">Runner ID: {me.runnerProfile.runnerCode}</ThemedText>}
        <ThemedText type="small">Your referral code: {me.referralCode}</ThemedText>
      </Card>

      {me.email && !me.emailVerifiedAt && (
        <Button title="Verify your email" variant="secondary" onPress={() => router.push('/verify-email')} />
      )}
      <Button title="Saved addresses" variant="secondary" onPress={() => router.push('/addresses')} />
      <Button title="Emergency contact" variant="secondary" onPress={() => router.push('/emergency-contact')} />
      {me.runnerProfile && <Button title="Runner registration" variant="secondary" onPress={() => router.push('/runner/onboarding')} />}
      {!me.runnerProfile && (
        <Button title="Become a runner and earn" variant="secondary" loading={addRole.isPending} onPress={() => addRole.mutate('runner')} />
      )}
      {!me.customerProfile && (
        <Button title="Also use ErrandCONNECT as a customer" variant="secondary" loading={addRole.isPending} onPress={() => addRole.mutate('customer')} />
      )}
      {addRole.error && <Notice tone="error">{addRole.error.message}</Notice>}
      <Button title="Log out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
