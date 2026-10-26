'use client';

import { ACTIVE_ORDER_STATUSES, haversineKm, ORDER_STATUS_LABELS, type OrderStatus } from '@errandconnect/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, KeyValue, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, fullName, humanize, kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  description: string;
  category: { name: string };
  deliveryType: string;
  urgency: string;
  pickupAddress: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffLabel: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  distanceKm: number;
  itemsCost: number;
  errandFee: number;
  deliveryFee: number;
  urgencyFee: number;
  serviceFee: number;
  total: number;
  runnerEarnings: number;
  paymentMethod: string;
  deliveryPin?: string;
  cancelReason: string | null;
  createdAt: string;
  customer: { id: string; firstName: string; lastName: string; phone?: string };
  runner: {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string;
    rating: number;
    location: { lat: number; lng: number; at: string } | null;
  } | null;
  events: { status: OrderStatus; note: string | null; createdAt: string }[];
  payment?: { status: string; providerReceipt: string | null; phone: string | null; failureReason: string | null } | null;
  escrowStatus: string | null;
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const key = ['/admin/orders', id];
  const { data: o, error } = useQuery({ queryKey: key, queryFn: () => api.get<Order>(`/admin/orders/${id}`), refetchInterval: 20_000 });
  const [runnerId, setRunnerId] = useState('');
  const [reason, setReason] = useState('');
  const refresh = [key, ['/admin/orders']];
  const assign = useAction(() => api.post(`/admin/orders/${id}/assign`, { runnerId }), refresh);
  const cancel = useAction(() => api.post(`/admin/orders/${id}/cancel`, { reason }), refresh);

  if (error) return <ErrorBox error={error} />;
  if (!o) return <Loading />;
  const active = ACTIVE_ORDER_STATUSES.includes(o.status);

  return (
    <>
      <PageHeader
        title={o.orderNumber}
        subtitle={`${o.category.name} · created ${dateTime(o.createdAt)}`}
        actions={<Badge status={o.status} />}
      />
      <ErrorBox error={assign.error ?? cancel.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Errand">
            <p className="mb-3">{o.description}</p>
            <KeyValue
              items={[
                ['Pickup', o.pickupAddress ?? '—'],
                ['Deliver to', `${o.dropoffLabel ? `${o.dropoffLabel}: ` : ''}${o.dropoffAddress}`],
                ['Recipient', o.recipientName ? `${o.recipientName} ${o.recipientPhone ?? ''}` : 'Customer'],
                ['Vehicle', humanize(o.deliveryType)],
                ['Urgency', humanize(o.urgency)],
                ['Distance', `${o.distanceKm} km`],
                ['Delivery PIN', o.deliveryPin],
                ['Cancel reason', o.cancelReason],
              ]}
            />
          </Card>
          <Card title="Timeline">
            <ol className="space-y-2 text-sm">
              {o.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    <span className="font-medium">{ORDER_STATUS_LABELS[e.status]}</span>
                    {e.note ? ` — ${e.note}` : ''}
                  </span>
                  <span className="whitespace-nowrap text-muted">{dateTime(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="People">
            <KeyValue
              items={[
                [
                  'Customer',
                  <Link key="c" className="text-brand hover:underline" href={`/customers/${o.customer.id}`}>
                    {fullName(o.customer)}
                  </Link>,
                ],
                ['Customer phone', o.customer.phone],
                [
                  'Runner',
                  o.runner ? (
                    <Link key="r" className="text-brand hover:underline" href={`/runners/${o.runner.id}`}>
                      {fullName(o.runner)}
                    </Link>
                  ) : (
                    'Not assigned'
                  ),
                ],
                ['Runner phone', o.runner?.phone],
                [
                  'Runner location',
                  o.runner?.location
                    ? `${o.runner.location.lat.toFixed(4)}, ${o.runner.location.lng.toFixed(4)} (${dateTime(o.runner.location.at)})`
                    : '—',
                ],
              ]}
            />
          </Card>
          <Card title="Money">
            <KeyValue
              items={[
                ['Items', kes(o.itemsCost)],
                ['Errand fee', kes(o.errandFee)],
                ['Delivery', kes(o.deliveryFee)],
                ['Urgency', kes(o.urgencyFee)],
                ['Service fee', kes(o.serviceFee)],
                ['Total', <b key="t">{kes(o.total)}</b>],
                ['Runner gets', kes(o.runnerEarnings)],
                ['Platform keeps', kes(o.total - o.runnerEarnings)],
                ['Paid by', humanize(o.paymentMethod)],
                [
                  'Payment',
                  o.payment ? `${humanize(o.payment.status)} ${o.payment.providerReceipt ?? ''} ${o.payment.failureReason ?? ''}` : '—',
                ],
                ['Escrow', o.escrowStatus ? <Badge key="e" status={o.escrowStatus} /> : '—'],
              ]}
            />
          </Card>
          {can('OPERATIONS_MANAGER') && o.status === 'PENDING' && (
            <Card title="Assign a runner">
              <AssignRunner order={o} value={runnerId} onChange={setRunnerId} />
              <Button className="mt-2" disabled={!runnerId} onClick={() => assign.mutate()} loading={assign.isPending}>
                Assign
              </Button>
            </Card>
          )}
          {active && (
            <Card title="Cancel order">
              <div className="space-y-2">
                <Textarea placeholder="Reason (shown to the customer)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => cancel.mutate()} loading={cancel.isPending}>
                  Cancel and refund
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

interface MapRunner {
  id: string;
  name: string;
  lat: number;
  lng: number;
  busy: boolean;
  deliveryTypes: string[];
}

/** Online runners who are free and use the right vehicle, nearest first. */
function AssignRunner({ order, value, onChange }: { order: Order; value: string; onChange: (id: string) => void }) {
  const { data } = useQuery({ queryKey: ['/admin/live-map'], queryFn: () => api.get<{ runners: MapRunner[] }>('/admin/live-map') });
  const start =
    order.pickupLat != null && order.pickupLng != null
      ? { lat: order.pickupLat, lng: order.pickupLng }
      : { lat: order.dropoffLat, lng: order.dropoffLng };
  const candidates = (data?.runners ?? [])
    .filter((r) => !r.busy && r.deliveryTypes.includes(order.deliveryType))
    .map((r) => ({ ...r, km: haversineKm(start, r) }))
    .sort((a, b) => a.km - b.km);
  if (!data) return <p className="text-sm text-muted">Loading runners…</p>;
  if (!candidates.length)
    return <p className="text-sm text-muted">No free runners online with a {humanize(order.deliveryType).toLowerCase()} right now.</p>;
  return (
    <Select
      aria-label="Runner"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[
        { value: '', label: 'Choose a runner…' },
        ...candidates.map((r) => ({ value: r.id, label: `${r.name} · ${r.km.toFixed(1)} km away` })),
      ]}
    />
  );
}
