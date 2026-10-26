import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

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

export default function HomeScreen() {
  const { me } = useAuth();
  if (!me) return null;
  const runnerStatus = me.runnerProfile?.applicationStatus;

  return (
    <Screen title={`Hi, ${me.firstName}`}>
      {me.runnerProfile && runnerStatus !== 'APPROVED' && <RunnerApplicationCard />}
      {runnerStatus === 'APPROVED' && <OnlineToggle online={me.runnerProfile!.isOnline} />}
      {me.customerProfile && <CustomerHome />}
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
      <Button title={online ? 'Go offline' : 'Go online'} variant={online ? 'secondary' : 'primary'} loading={toggle.isPending} onPress={() => toggle.mutate()} />
    </Card>
  );
}

function CustomerHome() {
  const theme = useTheme();
  const { data: categories } = useCategories();
  return (
    <>
      <ThemedText type="smallBold">What do you need done?</ThemedText>
      <View style={styles.grid}>
        {categories?.map((c) => (
          <View key={c.slug} style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small">{c.name}</ThemedText>
          </View>
        ))}
      </View>
      <Notice>Booking errands is coming soon. Save your addresses now so you&apos;re ready.</Notice>
      <Button title="Saved addresses" variant="secondary" onPress={() => router.push('/addresses')} />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { width: '48%', flexGrow: 1, minHeight: 64, borderRadius: Radius.medium, padding: Spacing.three, justifyContent: 'center' },
});
