import { ORDER_STATUS_LABELS } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { api } from '@/lib/api';
import { ORG_STATUS_LABELS, useShopDashboard, useShopOrders, type ShopOrder } from '@/lib/business';
import { formatKes } from '@/lib/orders';

export default function ShopDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<'ACTIVE' | 'PAST'>('ACTIVE');
  const { data: shop, isLoading, error } = useShopDashboard(id);
  const orders = useShopOrders(id, view);

  if (isLoading) return <Loading />;
  if (!shop) return <Notice tone="error">{error?.message ?? 'Shop not found'}</Notice>;
  return (
    <Screen>
      <Card>
        <ThemedText type="subtitle">{shop.name}</ThemedText>
        <ThemedText type="small">{ORG_STATUS_LABELS[shop.status]}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This month: {shop.thisMonth.orders} order{shop.thisMonth.orders === 1 ? '' : 's'} · {formatKes(shop.thisMonth.sales)} sales ·{' '}
          {formatKes(shop.thisMonth.commission)} commission ({Math.round(shop.commissionRate * 1000) / 10}%)
        </ThemedText>
        {shop.commissionOwed > 0 && <ThemedText type="small">Commission to be invoiced: {formatKes(shop.commissionOwed)}</ThemedText>}
      </Card>
      {shop.status === 'PENDING' && <Notice>We&apos;re reviewing your shop. It appears in the app once approved.</Notice>}
      <ChoiceChips
        choices={[
          { value: 'ACTIVE', label: `Open orders (${shop.openOrders})` },
          { value: 'PAST', label: 'Past' },
        ]}
        value={view}
        onChange={setView}
      />
      {orders.error && <Notice tone="error">{orders.error.message}</Notice>}
      {orders.data?.items.length === 0 && <Notice>{view === 'ACTIVE' ? 'No open orders right now.' : 'No past orders yet.'}</Notice>}
      {orders.data?.items.map((o) => (
        <ShopOrderCard key={o.id} shopId={id} order={o} />
      ))}
    </Screen>
  );
}

function ShopOrderCard({ shopId, order }: { shopId: string; order: ShopOrder }) {
  const queryClient = useQueryClient();
  const ready = useMutation({
    mutationFn: () => api.post(`/merchants/${shopId}/orders/${order.id}/ready`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['merchants', shopId] }),
  });
  const canMarkReady = !order.merchantReadyAt && ['PENDING', 'ACCEPTED', 'RUNNER_ASSIGNED', 'AT_STORE'].includes(order.status);
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {order.orderNumber} · for {order.customer.firstName}
      </ThemedText>
      <ThemedText type="smallBold">{ORDER_STATUS_LABELS[order.status]}</ThemedText>
      <ThemedText>{order.description}</ThemedText>
      <ThemedText type="small">Items about {formatKes(order.itemsCost)}</ThemedText>
      {order.runner ? (
        <ThemedText type="small">
          Runner: {order.runner.firstName} {order.runner.lastName}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Waiting for a runner to accept
        </ThemedText>
      )}
      {order.runner?.phone && <Button title="Call runner" variant="ghost" onPress={() => Linking.openURL(`tel:${order.runner!.phone}`)} />}
      {order.merchantReadyAt && <Notice tone="success">Marked ready for pickup</Notice>}
      {canMarkReady && <Button title="Order is packed and ready" loading={ready.isPending} onPress={() => ready.mutate()} />}
      {ready.error && <Notice tone="error">{ready.error.message}</Notice>}
    </Card>
  );
}
