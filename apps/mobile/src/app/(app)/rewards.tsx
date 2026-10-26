import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Share } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice, ProgressBar } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { api } from '@/lib/api';
import { growthKeys, useRewards, type Rewards } from '@/lib/growth';
import { formatKes, orderKeys } from '@/lib/orders';

export default function RewardsScreen() {
  const { data, isLoading, error } = useRewards();
  if (isLoading) return <Loading />;
  if (!data) return <Notice tone="error">{error?.message ?? 'Could not load your rewards'}</Notice>;
  return (
    <Screen>
      {data.loyalty.enabled && <Loyalty loyalty={data.loyalty} />}
      {data.referral.enabled && <Referral referral={data.referral} />}
    </Screen>
  );
}

function Loyalty({ loyalty }: { loyalty: Rewards['loyalty'] }) {
  const queryClient = useQueryClient();
  const redeem = useMutation({
    mutationFn: () => api.post<Rewards & { amount: number }>('/me/rewards/redeem', { points: loyalty.points }),
    onSuccess: (result) => {
      queryClient.setQueryData(growthKeys.rewards, result);
      queryClient.invalidateQueries({ queryKey: orderKeys.wallets });
    },
  });
  const tierGoal = loyalty.lifetimePoints + loyalty.pointsToNext;
  return (
    <>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          {loyalty.tier} member
        </ThemedText>
        <ThemedText type="title">{loyalty.points.toLocaleString('en-KE')} points</ThemedText>
        <ThemedText type="small">
          Earn {loyalty.pointsPer100} point{loyalty.pointsPer100 === 1 ? '' : 's'} for every KES 100 you spend. 100 points ={' '}
          {formatKes(loyalty.valuePer100Points)} wallet credit.
        </ThemedText>
        {loyalty.nextTier && (
          <>
            <ProgressBar percent={tierGoal ? Math.round((loyalty.lifetimePoints / tierGoal) * 100) : 0} />
            <ThemedText type="small" themeColor="textSecondary">
              {loyalty.pointsToNext} more points to {loyalty.nextTier}
            </ThemedText>
          </>
        )}
        {redeem.isSuccess && <Notice tone="success">{formatKes(redeem.data.amount)} added to your wallet.</Notice>}
        {redeem.error && <Notice tone="error">{redeem.error.message}</Notice>}
        {loyalty.redeemableValue > 0 ? (
          <Button
            title={`Turn into ${formatKes(loyalty.redeemableValue)} wallet credit`}
            loading={redeem.isPending}
            onPress={() => redeem.mutate()}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            You can redeem once you have {loyalty.minRedeemPoints} points.
          </ThemedText>
        )}
      </Card>
      {loyalty.history.length > 0 && (
        <Card>
          <ThemedText type="smallBold">Points history</ThemedText>
          {loyalty.history.map((h) => (
            <ThemedText key={h.id} type="small">
              {h.points > 0 ? `+${h.points}` : h.points} · {h.reason} · {new Date(h.createdAt).toLocaleDateString('en-KE')}
            </ThemedText>
          ))}
        </Card>
      )}
    </>
  );
}

function Referral({ referral }: { referral: Rewards['referral'] }) {
  const message =
    `Join me on ErrandCONNECT, the app for errands and deliveries in Kenya. Sign up with my code ${referral.code}` +
    (referral.refereeReward ? ` and get ${formatKes(referral.refereeReward)} after your first errand.` : '.');
  return (
    <Card>
      <ThemedText type="smallBold">Invite friends, earn {formatKes(referral.referrerReward)}</ThemedText>
      <ThemedText type="small">
        When someone signs up with your code and completes their first errand (as a customer or a runner), you get{' '}
        {formatKes(referral.referrerReward)}
        {referral.refereeReward ? ` and they get ${formatKes(referral.refereeReward)}` : ''}.
      </ThemedText>
      <ThemedText type="title" selectable>
        {referral.code}
      </ThemedText>
      <Button title="Share my code" onPress={() => Share.share({ message })} />
      <ThemedText type="small" themeColor="textSecondary">
        {referral.invited} joined · {referral.rewarded} completed an errand · {formatKes(referral.earned)} earned
      </ThemedText>
    </Card>
  );
}
