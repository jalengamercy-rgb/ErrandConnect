'use client';

import { ORDER_STATUS_LABELS, type OrderStatus } from '@errandconnect/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, KeyValue, Loading, Notice, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, fullName, humanize, kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface Dispute {
  id: string;
  type: string;
  description: string;
  status: string;
  outcome: string | null;
  refundAmount: number | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: { firstName: string; lastName: string } | null;
  previousOrderStatus: OrderStatus;
  createdAt: string;
  raisedBy: Person;
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    description: string;
    total: number;
    runnerEarnings: number;
    paymentMethod: string;
    customer: Person;
    runner: Person | null;
    escrow: { status: string; amount: number } | null;
    events: { status: OrderStatus; note: string | null; createdAt: string }[];
    messages: { id: string; body: string; senderId: string; createdAt: string }[];
  };
}

const OUTCOMES = [
  { value: 'REFUND_CUSTOMER', label: 'Refund the customer' },
  { value: 'PAY_RUNNER', label: 'Pay the runner' },
  { value: 'NO_ACTION', label: 'No action — continue the errand' },
];

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const key = ['/admin/disputes', id];
  const { data: d, error } = useQuery({ queryKey: key, queryFn: () => api.get<Dispute>(`/admin/disputes/${id}`) });
  const [outcome, setOutcome] = useState('REFUND_CUSTOMER');
  const [refundAmount, setRefundAmount] = useState('');
  const [resolution, setResolution] = useState('');
  const resolve = useAction(
    () =>
      api.post(`/admin/disputes/${id}/resolve`, {
        outcome,
        resolution,
        ...(outcome === 'REFUND_CUSTOMER' && refundAmount ? { refundAmount: Number(refundAmount) } : {}),
      }),
    [key, ['/admin/disputes']],
  );

  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const o = d.order;
  const escrowOnHold = o.escrow?.status === 'ON_HOLD';
  const nameOf = (senderId: string) =>
    senderId === o.customer.id ? fullName(o.customer) : o.runner && senderId === o.runner.id ? fullName(o.runner) : 'Someone';

  return (
    <>
      <PageHeader
        title={`${humanize(d.type)} · ${o.orderNumber}`}
        subtitle={`Raised by ${fullName(d.raisedBy)} on ${dateTime(d.createdAt)}`}
        actions={<Badge status={d.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="What they said">
            <p className="whitespace-pre-line">{d.description}</p>
          </Card>
          <Card title="Chat between customer and runner">
            {o.messages.length === 0 && <p className="text-sm text-muted">No messages.</p>}
            <ul className="space-y-2 text-sm">
              {o.messages.map((m) => (
                <li key={m.id}>
                  <span className="font-medium">{nameOf(m.senderId)}</span>{' '}
                  <span className="text-xs text-muted">{dateTime(m.createdAt)}</span>
                  <div>{m.body}</div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Order timeline">
            <ol className="space-y-1 text-sm">
              {o.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {ORDER_STATUS_LABELS[e.status]}
                    {e.note ? ` — ${e.note}` : ''}
                  </span>
                  <span className="whitespace-nowrap text-muted">{dateTime(e.createdAt)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Order">
            <KeyValue
              items={[
                [
                  'Order',
                  <Link key="o" className="text-brand hover:underline" href={`/orders/${o.id}`}>
                    {o.orderNumber}
                  </Link>,
                ],
                ['Errand', o.description],
                ['Customer', `${fullName(o.customer)} · ${o.customer.phone}`],
                ['Runner', o.runner ? `${fullName(o.runner)} · ${o.runner.phone}` : '—'],
                ['Total', kes(o.total)],
                ['Paid by', humanize(o.paymentMethod)],
                ['Money', o.escrow ? `${kes(o.escrow.amount)} · ${humanize(o.escrow.status)}` : 'No escrow (cash)'],
                ['Before dispute', ORDER_STATUS_LABELS[d.previousOrderStatus]],
              ]}
            />
          </Card>
          {d.status === 'OPEN' && can('OPERATIONS_MANAGER') ? (
            <Card title="Resolve">
              <div className="space-y-3">
                <Field label="Outcome">
                  <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} options={OUTCOMES} />
                </Field>
                {outcome === 'REFUND_CUSTOMER' &&
                  (escrowOnHold ? (
                    <Notice>
                      The full {kes(o.escrow!.amount)} held for this errand goes back to the customer&apos;s wallet and the order is
                      cancelled.
                    </Notice>
                  ) : (
                    <Field label="Credit amount (KES)" hint="This errand has no money on hold. The credit comes from platform revenue.">
                      <Input type="number" min={1} max={o.total} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
                    </Field>
                  ))}
                {outcome === 'PAY_RUNNER' && escrowOnHold && (
                  <Notice>The runner receives {kes(o.runnerEarnings)} and the order is completed.</Notice>
                )}
                {outcome === 'NO_ACTION' && (
                  <Notice>The order goes back to “{ORDER_STATUS_LABELS[d.previousOrderStatus]}” and the payment stays held.</Notice>
                )}
                <Field label="Resolution (sent to both people)">
                  <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} />
                </Field>
                <ErrorBox error={resolve.error} />
                <Button disabled={resolution.trim().length < 3} onClick={() => resolve.mutate()} loading={resolve.isPending}>
                  Resolve dispute
                </Button>
              </div>
            </Card>
          ) : (
            d.status === 'RESOLVED' && (
              <Card title="Resolution">
                <KeyValue
                  items={[
                    ['Outcome', humanize(d.outcome)],
                    ['Credit', d.refundAmount ? kes(d.refundAmount) : '—'],
                    ['Note', d.resolution],
                    ['By', d.resolvedBy ? fullName(d.resolvedBy) : '—'],
                    ['When', dateTime(d.resolvedAt)],
                  ]}
                />
              </Card>
            )
          )}
        </div>
      </div>
    </>
  );
}
