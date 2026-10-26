import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { humanize } from '@/lib/format';
import { formatKes, orderKeys, useJobs, useRunnerOrders } from '@/lib/orders';
import type { Job, Order } from '@/lib/types';

/** Open errands near the runner. New ones appear automatically. */
export default function JobsScreen() {
  const { me } = useAuth();
  const online = me?.runnerProfile?.isOnline === true;
  const { data: jobs, isLoading, error } = useJobs(online);
  const { data: current } = useRunnerOrders('active');

  if (!online) {
    return (
      <Screen>
        <Notice>Go online from the home screen to see jobs near you.</Notice>
      </Screen>
    );
  }
  if (isLoading) return <Loading />;

  const busy = current && current.length > 0;
  return (
    <Screen>
      {busy && (
        <Notice tone="warning">
          Finish your current errand before taking another.{' '}
          <ThemedText type="small" themeColor="primary" onPress={() => router.push(`/orders/${current[0].id}`)}>
            Open it
          </ThemedText>
        </Notice>
      )}
      {error && <Notice tone="error">{error.message}</Notice>}
      {jobs?.length === 0 && <Notice>No jobs nearby right now. Stay online — new ones appear here automatically.</Notice>}
      {jobs?.map((job) => (
        <JobCard key={job.id} job={job} disabled={!!busy} />
      ))}
    </Screen>
  );
}

function JobCard({ job, disabled }: { job: Job; disabled: boolean }) {
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${job.id}/accept`),
    onSuccess: (order) => {
      queryClient.setQueryData(orderKeys.detail(order.id), order);
      queryClient.invalidateQueries({ queryKey: orderKeys.jobs });
      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
      router.push(`/orders/${order.id}`);
    },
    // Someone else took it: refresh the list.
    onError: () => queryClient.invalidateQueries({ queryKey: orderKeys.jobs }),
  });

  return (
    <Card>
      <ThemedText type="smallBold">
        {job.category} · earn {formatKes(job.runnerFee)}
        {job.surgeBonus > 0 ? ` (incl. ${formatKes(job.surgeBonus)} busy-time bonus)` : ''}
      </ThemedText>
      <ThemedText type="small">{job.description}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {job.awayKm} km away · trip {job.distanceKm} km{job.urgency !== 'STANDARD' ? ` · ⚡ ${humanize(job.urgency)}` : ''}
      </ThemedText>
      {job.pickupAddress && <ThemedText type="small">Pickup: {job.pickupAddress}</ThemedText>}
      <ThemedText type="small">Deliver: {job.dropoffAddress}</ThemedText>
      {job.itemsCost > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          You&apos;ll buy items worth about {formatKes(job.itemsCost)} (paid back by the customer in cash)
        </ThemedText>
      )}
      {accept.error && <Notice tone="error">{accept.error.message}</Notice>}
      <Button title="Accept job" disabled={disabled} loading={accept.isPending} onPress={() => accept.mutate()} />
    </Card>
  );
}
