'use client';

import { ORDER_STATUSES } from '@errandconnect/shared';
import { useRouter } from 'next/navigation';
import { Badge, ErrorBox, Input, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { dateTime, fullName, humanize, kes } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  platformFee: number;
  paymentMethod: string;
  createdAt: string;
  category: { name: string };
  customer: { firstName: string; lastName: string; phone: string };
  runner: { firstName: string; lastName: string; phone: string } | null;
}

export default function OrdersPage() {
  const router = useRouter();
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<OrderRow, { status: string; search: string }>(
    '/admin/orders',
    {
      status: '',
      search: '',
    },
  );

  return (
    <>
      <PageHeader title="Orders" />
      <div className="mb-3 grid gap-2 sm:grid-cols-[220px_1fr]">
        <Select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={['', ...ORDER_STATUSES]}
          aria-label="Status"
        />
        <Input
          placeholder="Search order number, description or customer phone"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
        />
      </div>
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        columns={[
          {
            header: 'Order',
            cell: (o) => (
              <div>
                <div className="font-medium">{o.orderNumber}</div>
                <div className="text-xs text-muted">{o.category.name}</div>
              </div>
            ),
          },
          { header: 'Status', cell: (o) => <Badge status={o.status} /> },
          {
            header: 'Customer',
            cell: (o) => (
              <div>
                {fullName(o.customer)}
                <div className="text-xs text-muted">{o.customer.phone}</div>
              </div>
            ),
          },
          {
            header: 'Runner',
            cell: (o) =>
              o.runner ? (
                <div>
                  {fullName(o.runner)}
                  <div className="text-xs text-muted">{o.runner.phone}</div>
                </div>
              ) : (
                '—'
              ),
          },
          { header: 'Total', cell: (o) => kes(o.total) },
          { header: 'Fee', cell: (o) => kes(o.platformFee) },
          { header: 'Paid by', cell: (o) => humanize(o.paymentMethod) },
          { header: 'Created', cell: (o) => dateTime(o.createdAt) },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
