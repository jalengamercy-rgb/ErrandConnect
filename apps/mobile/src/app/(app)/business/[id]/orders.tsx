import { ORDER_STATUS_LABELS } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useBusiness, useBusinessOrders, type CompanyOrder } from '@/lib/business';
import { formatKes } from '@/lib/orders';

type View = 'PENDING_APPROVAL' | 'ACTIVE' | 'PAST';

export default function CompanyOrdersScreen() {
  const params = useLocalSearchParams<{ id: string; view?: View }>();
  const [view, setView] = useState<View>(params.view ?? 'ACTIVE');
  const { data: business } = useBusiness(params.id);
  const { data, isLoading, error } = useBusinessOrders(params.id, view);
  const manage = business && business.myRole !== 'MEMBER';

  return (
    <Screen>
      <ChoiceChips
        choices={[
          ...(manage ? [{ value: 'PENDING_APPROVAL' as const, label: 'Needs approval' }] : []),
          { value: 'ACTIVE', label: 'Active' },
          { value: 'PAST', label: 'Past' },
        ]}
        value={view}
        onChange={setView}
      />
      {isLoading && <Loading />}
      {error && <Notice tone="error">{error.message}</Notice>}
      {data?.items.length === 0 && (
        <Notice>{view === 'PENDING_APPROVAL' ? 'Nothing waiting for approval.' : 'No errands here yet.'}</Notice>
      )}
      {data?.items.map((o) => (view === 'PENDING_APPROVAL' ? <ApprovalCard key={o.id} order={o} /> : <OrderRow key={o.id} order={o} />))}
    </Screen>
  );
}

function OrderRow({ order }: { order: CompanyOrder }) {
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {order.orderNumber} · by {order.customer.firstName} {order.customer.lastName}
      </ThemedText>
      <ThemedText type="smallBold">{ORDER_STATUS_LABELS[order.status]}</ThemedText>
      <ThemedText type="small" numberOfLines={2}>
        {order.description}
      </ThemedText>
      <ThemedText type="small">{formatKes(order.total)}</ThemedText>
      <Button title="Open" variant="ghost" onPress={() => router.push(`/orders/${order.id}`)} />
    </Card>
  );
}

function ApprovalCard({ order }: { order: CompanyOrder }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      approve ? api.post(`/orders/${order.id}/approve`) : api.post(`/orders/${order.id}/reject`, { reason: reason.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {order.orderNumber} · requested by {order.customer.firstName} {order.customer.lastName}
      </ThemedText>
      <ThemedText>{order.description}</ThemedText>
      <ThemedText type="small">To: {order.dropoffAddress}</ThemedText>
      <ThemedText type="smallBold">{formatKes(order.total)}</ThemedText>
      {decide.error && <Notice tone="error">{decide.error.message}</Notice>}
      {rejecting ? (
        <>
          <TextField label="Reason (sent to your colleague)" value={reason} onChangeText={setReason} autoFocus />
          <Button
            title="Decline errand"
            variant="danger"
            disabled={reason.trim().length < 3}
            loading={decide.isPending}
            onPress={() => decide.mutate(false)}
          />
          <Button title="Never mind" variant="ghost" onPress={() => setRejecting(false)} />
        </>
      ) : (
        <>
          <Button title="Approve and bill the company" loading={decide.isPending} onPress={() => decide.mutate(true)} />
          <Button title="Decline" variant="ghost" onPress={() => setRejecting(true)} />
        </>
      )}
    </Card>
  );
}
