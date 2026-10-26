'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { date, kes } from '@/lib/format';
import { useAction, usePagedList } from '@/lib/hooks';

interface InvoiceRow {
  id: string;
  number: string;
  amount: number;
  status: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  business: { id: string; name: string } | null;
  merchant: { id: string; name: string } | null;
}

interface Org {
  id: string;
  name: string;
}

/** First and last day of last month, as yyyy-mm-dd. */
function lastMonth() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: iso(start), end: iso(end) };
}

export default function InvoicesPage() {
  const router = useRouter();
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<InvoiceRow, { status: string }>('/admin/invoices', {
    status: '',
  });
  const [kind, setKind] = useState<'business' | 'merchant'>('business');
  const [orgId, setOrgId] = useState('');
  const [period, setPeriod] = useState(lastMonth);
  const orgs = useQuery({
    queryKey: ['invoice-orgs', kind],
    queryFn: () => api.get<{ items: Org[] }>(`/admin/${kind === 'business' ? 'businesses' : 'merchants'}?status=ACTIVE&pageSize=100`),
  });
  const generate = useAction(async () => {
    const invoice = await api.post<{ id: string }>('/admin/invoices/generate', {
      [kind === 'business' ? 'businessId' : 'merchantId']: orgId,
      periodStart: new Date(`${period.start}T00:00:00`).toISOString(),
      periodEnd: new Date(`${period.end}T00:00:00`).toISOString(),
    });
    router.push(`/invoices/${invoice.id}`);
  }, [['/admin/invoices']]);

  return (
    <>
      <PageHeader title="Invoices" subtitle="Monthly bills for companies (their errands) and shops (commission)" />
      <div className="mb-4">
        <Card title="Create an invoice">
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[150px_1fr_160px_160px_auto]">
            <Field label="For">
              <Select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as 'business' | 'merchant');
                  setOrgId('');
                }}
                options={[
                  { value: 'business', label: 'Company' },
                  { value: 'merchant', label: 'Shop' },
                ]}
              />
            </Field>
            <Field label={kind === 'business' ? 'Company' : 'Shop'}>
              <Select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                options={[{ value: '', label: 'Choose…' }, ...(orgs.data?.items ?? []).map((o) => ({ value: o.id, label: o.name }))]}
              />
            </Field>
            <Field label="From">
              <Input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} />
            </Field>
            <Field label="Up to (not including)">
              <Input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} />
            </Field>
            <Button disabled={!orgId} onClick={() => generate.mutate()} loading={generate.isPending}>
              Create
            </Button>
          </div>
          <div className="mt-2">
            <ErrorBox error={generate.error} />
          </div>
        </Card>
      </div>
      <div className="mb-3 max-w-[200px]">
        <Select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={['', 'ISSUED', 'PAID', 'VOID']}
          aria-label="Status"
        />
      </div>
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(i) => router.push(`/invoices/${i.id}`)}
        columns={[
          { header: 'Invoice', cell: (i) => <span className="font-medium">{i.number}</span> },
          { header: 'Billed to', cell: (i) => (i.business ? `${i.business.name} (company)` : `${i.merchant?.name} (shop)`) },
          { header: 'Period', cell: (i) => `${date(i.periodStart)} – ${date(new Date(new Date(i.periodEnd).getTime() - 1))}` },
          { header: 'Amount', cell: (i) => kes(i.amount) },
          { header: 'Status', cell: (i) => <Badge status={i.status} /> },
          { header: 'Due', cell: (i) => date(i.dueDate) },
        ]}
        empty="No invoices yet."
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
