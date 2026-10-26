'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, KeyValue, Loading, PageHeader, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { date, fullName, humanize, kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Merchant {
  id: string;
  name: string;
  categorySlug: string;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  lat: number | null;
  lng: number | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  description: string | null;
  commissionRate: number | null;
  isFeatured: boolean;
  status: string;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  commissionOwed: number;
  completedOrders: number;
  totalSales: number;
  totalCommission: number;
  members: { userId: string; role: string; user: { id: string; firstName: string; lastName: string; phone: string } }[];
  invoices: { id: string; number: string; amount: number; status: string; dueDate: string }[];
}

export default function MerchantPage() {
  const { id } = useParams<{ id: string }>();
  const key = ['/admin/merchants', id];
  const { data: m, error } = useQuery({ queryKey: key, queryFn: () => api.get<Merchant>(`/admin/merchants/${id}`) });
  const refresh = [key, ['/admin/merchants']];
  const [rate, setRate] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const update = useAction((body: Record<string, unknown>) => api.patch(`/admin/merchants/${id}`, body), refresh);
  const approve = useAction(() => api.post(`/admin/merchants/${id}/approve`), refresh);
  const reject = useAction(() => api.post(`/admin/merchants/${id}/reject`, { reason }), refresh);
  const suspend = useAction(() => api.post(`/admin/merchants/${id}/suspend`, { reason }), refresh);

  if (error) return <ErrorBox error={error} />;
  if (!m) return <Loading />;
  const rateValue = rate ?? (m.commissionRate == null ? '' : String(Math.round(m.commissionRate * 1000) / 10));

  return (
    <>
      <PageHeader
        title={m.name}
        subtitle={`${humanize(m.categorySlug.replace(/-/g, '_'))} · joined ${date(m.createdAt)}`}
        actions={<Badge status={m.status} />}
      />
      <ErrorBox error={update.error ?? approve.error ?? reject.error ?? suspend.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Shop details">
            <KeyValue
              items={[
                ['Address', m.addressLine ?? '—'],
                ['Map', m.lat != null && m.lng != null ? `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}` : '—'],
                ['Phone', m.phone ?? '—'],
                ['Email', m.email ?? '—'],
                ['Registration no.', m.registrationNumber ?? '—'],
                ['Tax no.', m.taxNumber ?? '—'],
                ['About', m.description ?? '—'],
                ['Rating', m.ratingCount ? `${m.ratingAvg.toFixed(1)} (${m.ratingCount})` : 'No reviews yet'],
              ]}
            />
          </Card>
          <Card title="People">
            <Table
              rows={m.members}
              columns={[
                {
                  header: 'Name',
                  cell: (p) => (
                    <Link className="text-brand hover:underline" href={`/customers/${p.user.id}`}>
                      {fullName(p.user)}
                    </Link>
                  ),
                },
                { header: 'Phone', cell: (p) => p.user.phone },
                { header: 'Role', cell: (p) => humanize(p.role) },
              ]}
            />
          </Card>
          <Card title="Commission invoices">
            <Table
              rows={m.invoices}
              columns={[
                {
                  header: 'Invoice',
                  cell: (i) => (
                    <Link className="text-brand hover:underline" href={`/invoices/${i.id}`}>
                      {i.number}
                    </Link>
                  ),
                },
                { header: 'Amount', cell: (i) => kes(i.amount) },
                { header: 'Status', cell: (i) => <Badge status={i.status} /> },
                { header: 'Due', cell: (i) => date(i.dueDate) },
              ]}
              empty="No invoices yet."
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Sales">
            <KeyValue
              items={[
                ['Completed orders', m.completedOrders],
                ['Items sold', kes(m.totalSales)],
                ['Commission earned', kes(m.totalCommission)],
                ['Commission owed now', kes(m.commissionOwed)],
              ]}
            />
          </Card>
          <Card title="Listing">
            <div className="space-y-3">
              <Field label="Commission (%)" hint="Of the items cost on each completed order. Leave empty for the platform default.">
                <Input type="number" min={0} max={50} step={0.5} value={rateValue} onChange={(e) => setRate(e.target.value)} />
              </Field>
              <Button
                variant="secondary"
                onClick={() => update.mutate({ commissionRate: rateValue === '' ? null : Number(rateValue) / 100 })}
                loading={update.isPending}
              >
                Save commission
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={m.isFeatured} onChange={(e) => update.mutate({ isFeatured: e.target.checked })} />
                Featured at the top of the shop directory
              </label>
            </div>
          </Card>
          <Card title="Decision">
            <div className="space-y-3">
              {m.status !== 'ACTIVE' && (
                <Button onClick={() => approve.mutate()} loading={approve.isPending}>
                  {m.status === 'PENDING' ? 'Approve shop' : 'Reactivate shop'}
                </Button>
              )}
              {(m.status === 'PENDING' || m.status === 'ACTIVE') && (
                <>
                  <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (sent to the shop)" />
                  <Button
                    variant="danger"
                    disabled={reason.trim().length < 3}
                    onClick={() => (m.status === 'PENDING' ? reject : suspend).mutate()}
                    loading={reject.isPending || suspend.isPending}
                  >
                    {m.status === 'PENDING' ? 'Reject' : 'Suspend'}
                  </Button>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
