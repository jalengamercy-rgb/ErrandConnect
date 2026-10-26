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
import { DISPUTE_TYPES } from '@/lib/support';
import { ChoiceChips } from '@/components/ui/choice-chips';
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
  if (order.customer.id === me?.id) return <CustomerView order={order} />;
  if (order.runner?.id === me?.id) return <RunnerView order={order} />;
  // Company admins and shop staff looking at an errand placed by someone else.
  return <CompanyView order={order} />;
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
      <Button
        title={label}
        variant="danger"
        disabled={reason.trim().length < 3}
        loading={loading}
        onPress={() => onSubmit(reason.trim())}
      />
      <Button title="Never mind" variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}

const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Report a problem (freezes the errand and its payment for support) or contact support. */
function ProblemSection({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  // Time when the screen opened (render must not read the clock).
  const [openedAt] = useState(() => Date.now());
  const report = useOrderAction(order, async () => {
    await api.post(`/orders/${order.id}/disputes`, { type, description: description.trim() });
    setOpen(false);
    return api.get<Order>(`/orders/${order.id}`);
  });
  const completedAt = order.events.findLast((e) => e.status === 'COMPLETED')?.createdAt;
  const canReport =
    !!order.runner &&
    (RUNNER_ACTIVE_STATUSES.includes(order.status) ||
      (order.status === 'COMPLETED' && !!completedAt && openedAt - new Date(completedAt).getTime() < DISPUTE_WINDOW_MS));

  const contact = (
    <Button title="Contact support" variant="ghost" onPress={() => router.push({ pathname: '/support', params: { orderId: order.id } })} />
  );
  if (order.status === 'DISPUTED') {
    return (
      <>
        <Notice tone="warning">A problem was reported. Our support team is reviewing it and the payment is on hold until then.</Notice>
        {contact}
      </>
    );
  }
  return (
    <>
      {canReport &&
        (open ? (
          <Card>
            <ThemedText type="smallBold">What went wrong?</ThemedText>
            <ChoiceChips choices={DISPUTE_TYPES.map((d) => ({ value: d.value, label: d.label }))} value={type} onChange={setType} />
            <TextField
              label="Tell us what happened"
              multiline
              value={description}
              onChangeText={setDescription}
              hint="At least 10 characters"
            />
            {report.error && <Notice tone="error">{report.error.message}</Notice>}
            <Button
              title="Report problem"
              variant="danger"
              disabled={!type || description.trim().length < 10}
              loading={report.isPending}
              onPress={() => report.mutate(undefined)}
            />
            <Button title="Never mind" variant="ghost" onPress={() => setOpen(false)} />
          </Card>
        ) : (
          <Button title="Report a problem" variant="ghost" onPress={() => setOpen(true)} />
        ))}
      <Button
        title="Contact support"
        variant="ghost"
        onPress={() => router.push({ pathname: '/support', params: { orderId: order.id } })}
      />
    </>
  );
}

function RateCard({ order, who }: { order: Order; who: string }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const review = useOrderAction(order, () =>
    api.post<Order>(`/orders/${order.id}/review`, { stars, comment: comment.trim() || undefined }),
  );
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
  const active = RUNNER_ACTIVE_STATUSES.includes(order.status) || order.status === 'PENDING' || order.status === 'AWAITING_PAYMENT';
  const runner = order.runner;
  const awayKm = runner?.location ? haversineKm(runner.location, { lat: order.dropoffLat, lng: order.dropoffLng }) : null;

  return (
    <Screen>
      <Header order={order}>
        {order.business && (
          <ThemedText type="small" themeColor="textSecondary">
            🏢 {order.business.name}
          </ThemedText>
        )}
        {order.status === 'PENDING_APPROVAL' && (
          <ThemedText type="small" themeColor="textSecondary">
            A company owner or admin needs to approve this. We&apos;ll notify you.
          </ThemedText>
        )}
        {order.status === 'PENDING' && (
          <ThemedText type="small" themeColor="textSecondary">
            We&apos;ve told nearby runners. This page updates by itself when one accepts.
          </ThemedText>
        )}
      </Header>

      {order.status === 'AWAITING_PAYMENT' && <AwaitingPayment order={order} />}

      {active && order.status !== 'AWAITING_PAYMENT' && order.deliveryPin && (
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
            {runner.vehicle
              ? ` · ${runner.vehicle.make ?? ''} ${runner.vehicle.model ?? ''} ${runner.vehicle.registrationNumber ?? ''}`
              : ''}
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
            <Button
              title="See runner on map"
              variant="ghost"
              onPress={() => Linking.openURL(mapUrl(runner.location!.lat, runner.location!.lng))}
            />
          )}
        </Card>
      )}

      <RateCard order={order} who={runner?.firstName ?? 'your runner'} />
      <ProblemSection order={order} />

      <Card>
        <ThemedText type="smallBold">Deliver to {order.dropoffLabel ?? ''}</ThemedText>
        <ThemedText type="small">{order.dropoffAddress}</ThemedText>
        {order.pickupAddress && <ThemedText type="small">Pickup: {order.pickupAddress}</ThemedText>}
      </Card>
      <PriceBreakdown quote={order} distanceKm={order.distanceKm} />
      <PaymentStatus order={order} />
      <Timeline events={order.events} />

      {CUSTOMER_CANCELLABLE_STATUSES.includes(order.status) && (
        <Reasoned label="Cancel errand" loading={cancel.isPending} onSubmit={(reason) => cancel.mutate(reason)} />
      )}
      {cancel.error && <Notice tone="error">{cancel.error.message}</Notice>}
    </Screen>
  );
}

function CompanyView({ order }: { order: Order }) {
  const approve = useOrderAction(order, () => api.post<Order>(`/orders/${order.id}/approve`));
  const reject = useOrderAction(order, (reason: string) => api.post<Order>(`/orders/${order.id}/reject`, { reason }));
  return (
    <Screen>
      <Header order={order}>
        <ThemedText type="small" themeColor="textSecondary">
          Requested by {order.customer.firstName} {order.customer.lastName}
          {order.business ? ` for ${order.business.name}` : ''}
        </ThemedText>
      </Header>
      {order.status === 'PENDING_APPROVAL' && order.business && (
        <Card>
          <ThemedText type="smallBold">Approve {formatKes(order.total)} on the company invoice?</ThemedText>
          {(approve.error ?? reject.error) && <Notice tone="error">{(approve.error ?? reject.error)!.message}</Notice>}
          <Button title="Approve" loading={approve.isPending} onPress={() => approve.mutate(undefined)} />
          <Reasoned label="Decline" loading={reject.isPending} onSubmit={(reason) => reject.mutate(reason)} />
        </Card>
      )}
      {order.runner && (
        <Card>
          <ThemedText type="smallBold">
            Runner: {order.runner.firstName} {order.runner.lastName}
          </ThemedText>
        </Card>
      )}
      <Card>
        <ThemedText type="smallBold">Deliver to {order.dropoffLabel ?? ''}</ThemedText>
        <ThemedText type="small">{order.dropoffAddress}</ThemedText>
        {order.pickupAddress && <ThemedText type="small">Pickup: {order.pickupAddress}</ThemedText>}
      </Card>
      <PriceBreakdown quote={order} distanceKm={order.distanceKm} />
      <Timeline events={order.events} />
    </Screen>
  );
}

const PAYMENT_LABELS = { MPESA: 'M-Pesa', WALLET: 'wallet', CASH: 'cash', BUSINESS_INVOICE: 'company invoice' } as const;

/** "Check your phone" while waiting for the M-Pesa prompt to be answered. */
function AwaitingPayment({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const resend = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/orders/${order.id}/pay`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.id) }),
  });
  const check = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/payment/refresh`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.detail(order.id) }),
  });
  const payment = order.payment;
  const failed = payment && (payment.status === 'FAILED' || payment.status === 'CANCELLED');

  return (
    <Card>
      <ThemedText type="smallBold">Pay {formatKes(order.total)} with M-Pesa</ThemedText>
      {failed ? (
        <Notice tone="error">Payment didn&apos;t go through: {payment.failureReason ?? 'please try again'}.</Notice>
      ) : payment?.status === 'PENDING' ? (
        <ThemedText type="small">
          📱 Check your phone ({payment.phone}) and enter your M-Pesa PIN. This page updates once you pay.
        </ThemedText>
      ) : (
        <ThemedText type="small">We couldn&apos;t send the payment prompt. Try again.</ThemedText>
      )}
      {resend.error && <Notice tone="error">{resend.error.message}</Notice>}
      <Button
        title={failed || !payment ? 'Try paying again' : 'Resend prompt'}
        variant={failed ? 'primary' : 'secondary'}
        loading={resend.isPending}
        onPress={() => resend.mutate()}
      />
      {payment?.status === 'PENDING' && (
        <Button title="I've paid — check now" variant="ghost" loading={check.isPending} onPress={() => check.mutate()} />
      )}
    </Card>
  );
}

function PaymentStatus({ order }: { order: Order }) {
  if (order.status === 'AWAITING_PAYMENT') return null;
  if (order.status === 'PENDING_APPROVAL') return null;
  if (order.paymentMethod === 'BUSINESS_INVOICE') {
    return <Notice tone="success">Billed to {order.business?.name ?? 'your company'} on the monthly invoice.</Notice>;
  }
  if (order.paymentMethod === 'CASH') {
    const due = RUNNER_ACTIVE_STATUSES.includes(order.status) || order.status === 'PENDING';
    return due ? <Notice>Pay {formatKes(order.total)} in cash to the runner on delivery.</Notice> : null;
  }
  const receipt = order.payment?.providerReceipt ? ` · receipt ${order.payment.providerReceipt}` : '';
  const escrow = {
    HELD: 'Held safely until you give the runner your delivery PIN.',
    RELEASED: 'Paid to the runner after delivery.',
    REFUNDED: 'Refunded to your ErrandCONNECT wallet.',
    ON_HOLD: 'On hold while support reviews this errand.',
    DISPUTED: 'On hold while support reviews this errand.',
  };
  return (
    <Notice tone="success">
      Paid via {PAYMENT_LABELS[order.paymentMethod]}
      {receipt}. {order.escrowStatus ? escrow[order.escrowStatus] : ''}
    </Notice>
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
  const next =
    !order.pickupAddress && (order.status === 'ACCEPTED' || order.status === 'RUNNER_ASSIGNED')
      ? { status: 'IN_TRANSIT' as const, label: 'On my way to the customer' }
      : NEXT_STEP[order.status];

  return (
    <Screen>
      <Header order={order}>
        <ThemedText type="smallBold" themeColor="primary">
          You earn {formatKes(order.runnerFee)}
        </ThemedText>
      </Header>

      {order.merchant && active && (
        <Card>
          <ThemedText type="smallBold">🛍️ Collect from {order.merchant.name}</ThemedText>
          {order.merchant.addressLine && <ThemedText type="small">{order.merchant.addressLine}</ThemedText>}
          {order.merchantReadyAt ? (
            <Notice tone="success">The shop says the order is packed and ready.</Notice>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              The shop is preparing the order.
            </ThemedText>
          )}
          {order.merchant.phone && (
            <Button title="Call the shop" variant="ghost" onPress={() => Linking.openURL(`tel:${order.merchant!.phone}`)} />
          )}
        </Card>
      )}

      {active &&
        (order.paymentMethod === 'CASH' ? (
          <Notice>
            Collect {formatKes(order.total)} in cash from the customer
            {order.itemsCost > 0 ? `, including ${formatKes(order.itemsCost)} for items` : ''}. The platform fee of{' '}
            {formatKes(order.total - order.runnerEarnings)} is taken from your wallet.
          </Notice>
        ) : (
          <Notice tone="success">
            Paid in advance — don&apos;t collect any money.
            {order.itemsCost > 0 ? ` Buy the items (about ${formatKes(order.itemsCost)}); you get it back with your fee.` : ''}{' '}
            {formatKes(order.runnerEarnings)} goes to your wallet when you confirm delivery.
          </Notice>
        ))}

      <Card>
        <ThemedText type="smallBold">{order.recipientName ?? `${order.customer.firstName} ${order.customer.lastName}`}</ThemedText>
        <View style={styles.actions}>
          {(order.recipientPhone ?? order.customer.phone) && active && (
            <View style={styles.flex}>
              <Button
                title="Call"
                variant="secondary"
                onPress={() => Linking.openURL(`tel:${order.recipientPhone ?? order.customer.phone}`)}
              />
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
          {active && (
            <Button
              title="Navigate to pickup"
              variant="ghost"
              onPress={() => Linking.openURL(directionsUrl(order.pickupLat!, order.pickupLng!))}
            />
          )}
        </Card>
      )}
      <Card>
        <ThemedText type="smallBold">{order.pickupAddress ? '2. ' : ''}Deliver to</ThemedText>
        <ThemedText type="small">{order.dropoffAddress}</ThemedText>
        {active && (
          <Button
            title="Navigate to customer"
            variant="ghost"
            onPress={() => Linking.openURL(directionsUrl(order.dropoffLat, order.dropoffLng))}
          />
        )}
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
          <Button
            title="Confirm delivery"
            disabled={pin.length !== 4}
            loading={deliver.isPending}
            onPress={() => deliver.mutate(undefined)}
          />
        </Card>
      )}

      <RateCard order={order} who={order.customer.firstName} />
      <ProblemSection order={order} />
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
