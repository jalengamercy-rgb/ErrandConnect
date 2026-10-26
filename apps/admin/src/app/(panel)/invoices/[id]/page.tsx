'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, KeyValue, Loading, PageHeader, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { date, dateTime, kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Line {
  id: string;
  orderNumber: string;
  description: string;
  total: number;
  merchantCommission: number;
  completedAt: string;
}

interface Invoice {
  id: string;
  number: string;
  amount: number;
  status: string;
  kind: 'ORDERS' | 'COMMISSION' | 'FEATURED_LISTING';
  featuredWeeks: number | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  paidAt: string | null;
  paymentReference: string | null;
  createdAt: string;
  business: { id: string; name: string; kraPin: string | null; billingEmail: string | null } | null;
  merchant: { id: string; name: string; taxNumber: string | null; email: string | null } | null;
  orders: Line[];
  merchantOrders: Line[];
  payments: { status: string; amount: number; providerReceipt: string | null; createdAt: string }[];
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const key = ['/admin/invoices', id];
  const { data: inv, error } = useQuery({ queryKey: key, queryFn: () => api.get<Invoice>(`/admin/invoices/${id}`) });
  const refresh = [key, ['/admin/invoices']];
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const markPaid = useAction(() => api.post(`/admin/invoices/${id}/mark-paid`, { reference }), refresh);
  const voidIt = useAction(() => api.post(`/admin/invoices/${id}/void`, { reason }), refresh);

  if (error) return <ErrorBox error={error} />;
  if (!inv) return <Loading />;
  const isCompany = !!inv.business;
  const lines = isCompany ? inv.orders : inv.merchantOrders;
  const billedTo = inv.business ?? inv.merchant!;

  return (
    <>
      <PageHeader
        title={`Invoice ${inv.number}`}
        subtitle={`${date(inv.periodStart)} – ${date(new Date(new Date(inv.periodEnd).getTime() - 1))} · due ${date(inv.dueDate)}`}
        actions={<Badge status={inv.status} />}
      />
      <ErrorBox error={markPaid.error ?? voidIt.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={
              inv.kind === 'FEATURED_LISTING'
                ? 'Featured listing'
                : isCompany
                  ? `Errands (${lines.length})`
                  : `Commission on shop orders (${lines.length})`
            }
          >
            {inv.kind === 'FEATURED_LISTING' && (
              <p className="text-sm">
                {inv.featuredWeeks} week{inv.featuredWeeks === 1 ? '' : 's'} at the top of the shop directory. Starts when this invoice is
                paid.
              </p>
            )}
            {inv.kind !== 'FEATURED_LISTING' && (
              <Table
                rows={lines}
                columns={[
                  {
                    header: 'Order',
                    cell: (o) => (
                      <Link className="text-brand hover:underline" href={`/orders/${o.id}`}>
                        {o.orderNumber}
                      </Link>
                    ),
                  },
                  { header: 'Description', cell: (o) => <span className="line-clamp-1">{o.description}</span> },
                  { header: 'Completed', cell: (o) => date(o.completedAt) },
                  { header: isCompany ? 'Total' : 'Commission', cell: (o) => kes(isCompany ? o.total : o.merchantCommission) },
                ]}
              />
            )}
            <div className="mt-3 text-right font-semibold">Amount due: {kes(inv.amount)}</div>
          </Card>
          <Card title="Payments">
            <Table
              rows={inv.payments}
              columns={[
                { header: 'Date', cell: (p) => dateTime(p.createdAt) },
                { header: 'Amount', cell: (p) => kes(p.amount) },
                { header: 'Receipt', cell: (p) => p.providerReceipt ?? '—' },
                { header: 'Status', cell: (p) => <Badge status={p.status} /> },
              ]}
              empty="No M-Pesa payment attempts."
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Billed to">
            <KeyValue
              items={[
                [
                  isCompany ? 'Company' : 'Shop',
                  <Link
                    key="o"
                    className="text-brand hover:underline"
                    href={isCompany ? `/businesses/${billedTo.id}` : `/merchants/${billedTo.id}`}
                  >
                    {billedTo.name}
                  </Link>,
                ],
                ['Tax PIN', (inv.business?.kraPin ?? inv.merchant?.taxNumber) || '—'],
                ['Email', (inv.business?.billingEmail ?? inv.merchant?.email) || '—'],
                ['Issued', dateTime(inv.createdAt)],
                ['Paid', inv.paidAt ? `${dateTime(inv.paidAt)} · ${inv.paymentReference ?? ''}` : '—'],
              ]}
            />
          </Card>
          {inv.status === 'ISSUED' && (
            <>
              <Card title="Record a payment">
                <Field label="Bank or M-Pesa reference">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. FT26102612345" />
                </Field>
                <Button
                  className="mt-2"
                  disabled={reference.trim().length < 3}
                  onClick={() => markPaid.mutate()}
                  loading={markPaid.isPending}
                >
                  Mark as paid
                </Button>
              </Card>
              <Card title="Void">
                <p className="mb-2 text-sm text-muted">The orders go back to unbilled and can be put on a new invoice.</p>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
                <Button
                  className="mt-2"
                  variant="danger"
                  disabled={reason.trim().length < 3}
                  onClick={() => voidIt.mutate()}
                  loading={voidIt.isPending}
                >
                  Void invoice
                </Button>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
