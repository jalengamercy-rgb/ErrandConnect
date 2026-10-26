import { normalizeKenyanPhone, ORDER_STATUS_LABELS } from '@errandconnect/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
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
      {shop.status === 'ACTIVE' && <GetFeatured shopId={id} />}
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

interface FeaturedOffer {
  weeklyPrice: number;
  featuredUntil: string | null;
  openInvoice: { id: string; number: string; amount: number; featuredWeeks: number } | null;
}

/** Pay to appear at the top of the shop directory. */
function GetFeatured({ shopId }: { shopId: string }) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const key = ['merchants', shopId, 'featured'];
  const { data: offer } = useQuery({
    queryKey: key,
    queryFn: () => api.get<FeaturedOffer>(`/merchants/${shopId}/featured`),
    // While an invoice is open, check for the payment so the screen updates by itself.
    refetchInterval: (query) => (query.state.data?.openInvoice ? 5_000 : false),
  });
  const [weeks, setWeeks] = useState(1);
  const [phone, setPhone] = useState(me?.phone ? `0${me.phone.slice(4)}` : '');
  const buy = useMutation({
    mutationFn: () => api.post<{ payment: { message: string } | null }>(`/merchants/${shopId}/featured`, { weeks, phone }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const pay = useMutation({
    mutationFn: (invoiceId: string) => api.post<{ message: string }>(`/invoices/${invoiceId}/pay`, { phone }),
  });
  if (!offer) return null;
  const until = offer.featuredUntil && new Date(offer.featuredUntil) > new Date() ? new Date(offer.featuredUntil) : null;

  return (
    <Card>
      <ThemedText type="smallBold">⭐ Get featured</ThemedText>
      <ThemedText type="small">Appear at the top of the shop list for customers nearby. {formatKes(offer.weeklyPrice)} a week.</ThemedText>
      {until && <Notice tone="success">Featured until {until.toLocaleDateString('en-KE', { day: 'numeric', month: 'long' })}.</Notice>}
      <TextField label="M-Pesa number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      {buy.data?.payment && offer.openInvoice && <Notice tone="success">{buy.data.payment.message}</Notice>}
      {offer.openInvoice ? (
        <>
          <Notice>
            Invoice {offer.openInvoice.number} for {offer.openInvoice.featuredWeeks} week{offer.openInvoice.featuredWeeks === 1 ? '' : 's'}{' '}
            ({formatKes(offer.openInvoice.amount)}) is waiting for payment. Your placement starts once it&apos;s paid.
          </Notice>
          {pay.isSuccess && <Notice tone="success">{pay.data.message}</Notice>}
          {pay.error && <Notice tone="error">{pay.error.message}</Notice>}
          <Button
            title="Pay with M-Pesa"
            disabled={!normalizeKenyanPhone(phone)}
            loading={pay.isPending}
            onPress={() => pay.mutate(offer.openInvoice!.id)}
          />
        </>
      ) : (
        <>
          <ChoiceChips
            choices={[1, 2, 4].map((w) => ({ value: w, label: `${w} week${w === 1 ? '' : 's'} · ${formatKes(w * offer.weeklyPrice)}` }))}
            value={weeks}
            onChange={setWeeks}
          />
          {buy.error && <Notice tone="error">{buy.error.message}</Notice>}
          <Button
            title={until ? `Extend by ${weeks} week${weeks === 1 ? '' : 's'}` : `Feature my shop`}
            disabled={!normalizeKenyanPhone(phone)}
            loading={buy.isPending}
            onPress={() => buy.mutate()}
          />
        </>
      )}
    </Card>
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
