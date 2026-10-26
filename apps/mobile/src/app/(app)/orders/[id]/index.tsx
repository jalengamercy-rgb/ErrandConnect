import {
  CUSTOMER_CANCELLABLE_STATUSES,
  ORDER_STATUS_LABELS,
  RUNNER_ACTIVE_STATUSES,
  RUNNER_RELEASABLE_STATUSES,
  haversineKm,
  type RunnerProgressStatus,
} from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { PriceBreakdown, StarRating, Timeline } from '@/features/orders/components';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { directionsUrl, formatKes, mapUrl, orderKeys, useOrder } from '@/lib/orders';
import type { Order } from '@/lib/types';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const { data: order, isLoading, error } = useOrder(id);

  if (isLoading) return <Loading />;
  if (!order) {
    return (
      <Screen>
        <Notice tone="error">{error?.message ?? 'Errand not found'}</Notice>
      </Screen>
    );
  }
  return order.customer.id === me?.id ? <CustomerView order={order} /> : <RunnerView order={order} />;
}

/** Runs an order action and puts the updated order straight into the cache. */
function useOrderAction<T>(order: Order, request: (body: T) => Promise<Order>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (updated) => {
      queryClient.setQueryData(orderKeys.detail(order.id), updated);
      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
    },
  });
}

const timeAgo = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
};

function Header({ order, children }: { order: Order; children?: React.ReactNode }) {
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {order.category.name} · {order.orderNumber}
      </ThemedText>
      <ThemedText type="subtitle">{ORDER_STATUS_LABELS[order.status]}</ThemedText>
      <ThemedText>{order.description}</ThemedText>
      {order.cancelReason && <Notice tone="warning">Cancelled: {order.cancelReason}</Notice>}
      {children}
    </Card>
  );
}

function Reasoned({ label, onSubmit, loading }: { label: string; onSubmit: (reason: string) => void; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <Button title={label} variant="ghost" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <TextField label="Reason" value={reason} onChangeText={setReason} autoFocus />
      <Button title={label} variant="danger" disabled={reason.trim().length < 3} loading={loading} onPress={() => onSubmit(reason.trim())} />
      <Button title="Never mind" variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}

function RateCard({ order, who }: { order: Order; who: string }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const review = useOrderAction(order, () => api.post<Order>(`/orders/${order.id}/review`, { stars, comment: comment.trim() || undefined }));
  if (order.status !== 'COMPLETED') return null;
  if (order.myReview) {
    return (
      <Card>
        <ThemedText type="smallBold">Your rating</ThemedText>
        <StarRating value={order.myReview.stars} />
      </Card>
    );
  }
  return (
    <Card>
      <ThemedText type="smallBold">How was {who}?</ThemedText>
      <StarRating value={stars} onChange={setStars} />
      <TextField label="Comment" optional value={comment} onChangeText={setComment} />
      {review.error && <Notice tone="error">{review.error.message}</Notice>}
      <Button title="Submit rating" disabled={stars === 0} loading={review.isPending} onPress={() => review.mutate(undefined)} />
    </Card>
  );
}

function CustomerView({ order }: { order: Order }) {
  const cancel = useOrderAction(order, (reason: string) => api.post<Order>(`/orders/${order.id}/cancel`, { reason }));
  const active = RUNNER_ACTIVE_STATUSES.includes(order.status) || order.status === 'PENDING';
  const runner = order.runner;
  const awayKm = runner?.location ? haversineKm(runner.location, { lat: order.dropoffLat, lng: order.dropoffLng }) : null;

  return (
    <Screen>
      <Header order={order}>
        {order.status === 'PENDING' && (
          <ThemedText type="small" themeColor="textSecondary">
            We&apos;ve told nearby runners. This page updates by itself when one accepts.
          </ThemedText>
        )}
      </Header>

      {active && order.deliveryPin && (
        <Card>
          <ThemedText type="smallBold">Delivery PIN</ThemedText>
          <ThemedText type="title" style={styles.pin}>
            {order.deliveryPin}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Give this to the runner only when you have received your errand.
          </ThemedText>
        </Card>
      )}

      {runner && (
        <Card>
          <ThemedText type="smallBold">
            {runner.firstName} {runner.lastName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ★ {runner.ratingCount ? runner.rating.toFixed(1) : 'New'} · {runner.jobsCompleted} errand{runner.jobsCompleted === 1 ? '' : 's'}
            {runner.vehicle ? ` · ${runner.vehicle.make ?? ''} ${runner.vehicle.model ?? ''} ${runner.vehicle.registrationNumber ?? ''}` : ''}
          </ThemedText>
          {runner.location && (
            <ThemedText type="small">
              📍 About {awayKm!.toFixed(1)} km from the delivery point · updated {timeAgo(runner.location.at)}
            </ThemedText>
          )}
          <View style={styles.actions}>
            {runner.phone && (
              <View style={styles.flex}>
                <Button title="Call" variant="secondary" onPress={() => Linking.openURL(`tel:${runner.phone}`)} />
              </View>
            )}
            <View style={styles.flex}>
              <Button title="Chat" variant="secondary" onPress={() => router.push(`/orders/${order.id}/chat`)} />
            </View>
          </View>
          {runner.location && active && (
            <Button title="See runner on map" variant="ghost" onPress={() => Linking.openURL(mapUrl(runner.location!.lat, runner.location!.lng))} />
          )}
        </Card>
      )}

      <RateCard order={order} who={runner?.firstName ?? 'your runner'} />

      <Card>
        <ThemedText type="smallBold">Deliver to {order.dropoffLabel ?? ''}</ThemedText>
        <ThemedText type="small">{order.dropoffAddress}</ThemedText>
        {order.pickupAddress && <ThemedText type="small">Pickup: {order.pickupAddress}</ThemedText>}
      </Card>
      <PriceBreakdown quote={order} distanceKm={order.distanceKm} />
      {active && <Notice>Pay {formatKes(order.total)} in cash to the runner on delivery (items cost may change slightly).</Notice>}
      <Timeline events={order.events} />

      {CUSTOMER_CANCELLABLE_STATUSES.includes(order.status) && (
        <Reasoned label="Cancel errand" loading={cancel.isPending} onSubmit={(reason) => cancel.mutate(reason)} />
      )}
      {cancel.error && <Notice tone="error">{cancel.error.message}</Notice>}
    </Screen>
  );
}

const NEXT_STEP: Partial<Record<Order['status'], { status: RunnerProgressStatus; label: string }>> = {
  ACCEPTED: { status: 'AT_STORE', label: 'I have arrived at the pickup' },
  RUNNER_ASSIGNED: { status: 'AT_STORE', label: 'I have arrived at the pickup' },
  AT_STORE: { status: 'PICKED_UP', label: 'I have the items' },
  PICKED_UP: { status: 'IN_TRANSIT', label: 'On my way to the customer' },
};

function RunnerView({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const progress = useOrderAction(order, (status: RunnerProgressStatus) => api.post<Order>(`/orders/${order.id}/progress`, { status }));
  const deliver = useOrderAction(order, () => api.post<Order>(`/orders/${order.id}/deliver`, { pin }));
  const release = useMutation({
    mutationFn: (reason: string) => api.post(`/orders/${order.id}/release`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
      router.replace('/jobs');
    },
  });

  const active = RUNNER_ACTIVE_STATUSES.includes(order.status);
  // Errands without a pickup point go straight from accepted to "on my way".
  const next = !order.pickupAddress && (order.status === 'ACCEPTED' || order.status === 'RUNNER_ASSIGNED')
    ? { status: 'IN_TRANSIT' as const, label: 'On my way to the customer' }
    : NEXT_STEP[order.status];

  return (
    <Screen>
      <Header order={order}>
        <ThemedText type="smallBold" themeColor="primary">
          You earn {formatKes(order.runnerFee)}
        </ThemedText>
      </Header>

      {active && (
        <Notice>
          Collect {formatKes(order.total)} in cash from the customer
          {order.itemsCost > 0 ? `, including ${formatKes(order.itemsCost)} for items (adjust to the receipt)` : ''}.
        </Notice>
      )}

      <Card>
        <ThemedText type="smallBold">
          {order.recipientName ?? `${order.customer.firstName} ${order.customer.lastName}`}
        </ThemedText>
        <View style={styles.actions}>
          {(order.recipientPhone ?? order.customer.phone) && active && (
            <View style={styles.flex}>
              <Button title="Call" variant="secondary" onPress={() => Linking.openURL(`tel:${order.recipientPhone ?? order.customer.phone}`)} />
            </View>
          )}
          <View style={styles.flex}>
            <Button title="Chat" variant="secondary" onPress={() => router.push(`/orders/${order.id}/chat`)} />
          </View>
        </View>
      </Card>

      {order.pickupAddress && order.pickupLat != null && order.pickupLng != null && (
        <Card>
          <ThemedText type="smallBold">1. Pickup</ThemedText>
          <ThemedText type="small">{order.pickupAddress}</ThemedText>
          {active && <Button title="Navigate to pickup" variant="ghost" onPress={() => Linking.openURL(directionsUrl(order.pickupLat!, order.pickupLng!))} />}
        </Card>
      )}
      <Card>
        <ThemedText type="smallBold">{order.pickupAddress ? '2. ' : ''}Deliver to</ThemedText>
        <ThemedText type="small">{order.dropoffAddress}</ThemedText>
        {active && <Button title="Navigate to customer" variant="ghost" onPress={() => Linking.openURL(directionsUrl(order.dropoffLat, order.dropoffLng))} />}
      </Card>

      {active && next && <Button title={next.label} loading={progress.isPending} onPress={() => progress.mutate(next.status)} />}
      {progress.error && <Notice tone="error">{progress.error.message}</Notice>}

      {active && (
        <Card>
          <ThemedText type="smallBold">Complete delivery</ThemedText>
          <TextField
            label="Customer's 4-digit delivery PIN"
            keyboardType="number-pad"
            maxLength={4}
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
          />
          {deliver.error && <Notice tone="error">{deliver.error.message}</Notice>}
          <Button title="Confirm delivery" disabled={pin.length !== 4} loading={deliver.isPending} onPress={() => deliver.mutate(undefined)} />
        </Card>
      )}

      <RateCard order={order} who={order.customer.firstName} />
      <Timeline events={order.events} />

      {RUNNER_RELEASABLE_STATUSES.includes(order.status) && (
        <Reasoned label="Hand this job back" loading={release.isPending} onSubmit={(reason) => release.mutate(reason)} />
      )}
      {release.error && <Notice tone="error">{release.error.message}</Notice>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pin: { letterSpacing: 12 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});
