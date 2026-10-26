'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, KeyValue, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, fullName } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Ticket {
  id: string;
  number: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; phone: string; email: string | null };
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  order: { id: string; orderNumber: string; status: string } | null;
  messages: { id: string; body: string; fromStaff: boolean; createdAt: string; author: { firstName: string; lastName: string } }[];
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const key = ['/admin/tickets', id];
  const { data: t, error } = useQuery({ queryKey: key, queryFn: () => api.get<Ticket>(`/admin/tickets/${id}`), refetchInterval: 20_000 });
  const [message, setMessage] = useState('');
  const refresh = [key, ['/admin/tickets']];
  const reply = useAction(async () => {
    await api.post(`/admin/tickets/${id}/messages`, { message });
    setMessage('');
  }, refresh);
  const update = useAction((body: Record<string, unknown>) => api.patch(`/admin/tickets/${id}`, body), refresh);

  if (error) return <ErrorBox error={error} />;
  if (!t) return <Loading />;

  return (
    <>
      <PageHeader title={t.subject} subtitle={`${t.number} · opened ${dateTime(t.createdAt)}`} actions={<Badge status={t.status} />} />
      <ErrorBox error={reply.error ?? update.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Conversation">
            <ul className="space-y-3">
              {t.messages.map((m) => (
                <li key={m.id} className={`rounded-lg p-3 text-sm ${m.fromStaff ? 'ml-8 bg-brand-soft' : 'mr-8 border border-border'}`}>
                  <div className="mb-1 text-xs text-muted">
                    {m.fromStaff ? `${fullName(m.author)} (support)` : fullName(m.author)} · {dateTime(m.createdAt)}
                  </div>
                  <div className="whitespace-pre-line">{m.body}</div>
                </li>
              ))}
            </ul>
          </Card>
          {t.status !== 'CLOSED' && (
            <Card title="Reply">
              <Textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="The customer gets this in their app inbox"
              />
              <Button className="mt-2" disabled={!message.trim()} onClick={() => reply.mutate()} loading={reply.isPending}>
                Send reply
              </Button>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Customer">
            <KeyValue
              items={[
                [
                  'Name',
                  <Link key="u" className="text-brand hover:underline" href={`/customers/${t.user.id}`}>
                    {fullName(t.user)}
                  </Link>,
                ],
                ['Phone', t.user.phone],
                ['Email', t.user.email],
                [
                  'Order',
                  t.order ? (
                    <Link key="o" className="text-brand hover:underline" href={`/orders/${t.order.id}`}>
                      {t.order.orderNumber}
                    </Link>
                  ) : (
                    '—'
                  ),
                ],
              ]}
            />
          </Card>
          <Card title="Ticket">
            <div className="space-y-3">
              <Field label="Status">
                <Select
                  value={t.status}
                  onChange={(e) => update.mutate({ status: e.target.value })}
                  options={['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']}
                />
              </Field>
              <Field label="Priority">
                <Select
                  value={t.priority}
                  onChange={(e) => update.mutate({ priority: e.target.value })}
                  options={['LOW', 'NORMAL', 'HIGH', 'URGENT']}
                />
              </Field>
              <div className="text-sm">Assigned to: {t.assignedTo ? fullName(t.assignedTo) : 'nobody'}</div>
              {t.assignedTo?.id !== me?.id && (
                <Button variant="secondary" onClick={() => update.mutate({ assignedToId: me?.id })}>
                  Assign to me
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
