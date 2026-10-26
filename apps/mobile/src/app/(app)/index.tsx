import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Notice, ProgressBar } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { ME_QUERY_KEY, useAuth } from '@/lib/auth-context';
import { getCurrentLocation } from '@/lib/device';
import { useCategories, useOnboarding } from '@/lib/queries';
import { OrderRow } from '@/features/orders/components';
import { formatKes, useCustomerOrders, useRunnerOrders, useWallets } from '@/lib/orders';

export default function HomeScreen() {
  const { me } = useAuth();
  if (!me) return null;
  const runnerStatus = me.runnerProfile?.applicationStatus;

  return (
    <Screen title={`Hi, ${me.firstName}`}>
      {me.runnerProfile && runnerStatus !== 'APPROVED' && <RunnerApplicationCard />}
      {runnerStatus === 'APPROVED' && <OnlineToggle online={me.runnerProfile!.isOnline} />}
      {me.customerProfile && <CustomerHome />}
      <Button title="Wallet" variant="secondary" onPress={() => router.push('/wallet')} />
      <Button title="Profile & settings" variant="secondary" onPress={() => router.push('/profile')} />
    </Screen>
  );
}

function RunnerApplicationCard() {
  const { data } = useOnboarding();
  if (!data) return null;
  const submitted = data.applicationStatus !== 'DRAFT' && data.applicationStatus !== 'REJECTED';
  return (
    <Card>
      <ThemedText type="smallBold">Runner application</ThemedText>
      {data.applicationStatus === 'REJECTED' && (
        <Notice tone="error">Changes needed: {data.rejectionReason ?? 'please review your details'}</Notice>
      )}
      {submitted ? (
        <ThemedText type="small" themeColor="textSecondary">
          Submitted — we&apos;re reviewing your documents. We&apos;ll notify you when you&apos;re approved.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {data.percentComplete}% complete
          </ThemedText>
          <ProgressBar percent={data.percentComplete} />
        </>
      )}
      <Button title={submitted ? 'View status' : 'Continue registration'} onPress={() => router.push('/runner/onboarding')} />
    </Card>
  );
}

function OnlineToggle({ online }: { online: boolean }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: async () => {
      if (online) return api.put('/runners/me/online', { online: false });
      return api.put('/runners/me/online', { online: true, ...(await getCurrentLocation()) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
  return (
    <Card>
      <ThemedText type="smallBold">{online ? '🟢 You are online' : '⚪ You are offline'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {online ? 'You can receive errand requests nearby.' : 'Go online to start receiving errands.'}
      </ThemedText>
      {toggle.error && <Notice tone="error">{toggle.error.message}</Notice>}
      <Button
        title={online ? 'Go offline' : 'Go online'}
        variant={online ? 'secondary' : 'primary'}
        loading={toggle.isPending}
        onPress={() => toggle.mutate()}
      />
      <EarningsLine />
      {online && <Button title="Find jobs nearby" onPress={() => router.push('/jobs')} />}
      <CurrentJob />
    </Card>
  );
}

function EarningsLine() {
  const { data } = useWallets();
  const runnerWallet = data?.find((w) => w.type === 'RUNNER');
  if (!runnerWallet) return null;
  return (
    <ThemedText type="small" themeColor={runnerWallet.balance < 0 ? 'warning' : 'textSecondary'}>
      Earnings balance: {formatKes(runnerWallet.balance)}
    </ThemedText>
  );
}

function CurrentJob() {
  const { data } = useRunnerOrders('active');
  if (!data?.length) return null;
  return (
    <>
      <ThemedText type="smallBold">Your current job</ThemedText>
      <OrderRow order={data[0]} />
    </>
  );
}

function CustomerHome() {
  const theme = useTheme();
  const { data: categories } = useCategories();
  const { data: active } = useCustomerOrders('active');
  return (
    <>
      {active && active.length > 0 && (
        <>
          <ThemedText type="smallBold">In progress</ThemedText>
          {active.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </>
      )}
      <ThemedText type="smallBold">What do you need done?</ThemedText>
      <View style={styles.grid}>
        {categories?.map((c) => (
          <Pressable
            key={c.slug}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/orders/new', params: { category: c.slug } })}
            style={({ pressed }) => [styles.tile, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}
          >
            <ThemedText type="small">{c.name}</ThemedText>
          </Pressable>
        ))}
      </View>
      <Button title="My errands" variant="secondary" onPress={() => router.push('/orders')} />
      <Button title="Saved addresses" variant="secondary" onPress={() => router.push('/addresses')} />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { width: '48%', flexGrow: 1, minHeight: 64, borderRadius: Radius.medium, padding: Spacing.three, justifyContent: 'center' },
});
