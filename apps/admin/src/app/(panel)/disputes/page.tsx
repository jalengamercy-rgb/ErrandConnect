'use client';

import { useRouter } from 'next/navigation';
import { Badge, ErrorBox, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { dateTime, fullName, humanize, kes } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface DisputeRow {
  id: string;
  type: string;
  status: string;
  outcome: string | null;
  createdAt: string;
  description: string;
  order: { id: string; orderNumber: string; total: number; paymentMethod: string };
  raisedBy: { firstName: string; lastName: string; phone: string };
}

export default function DisputesPage() {
  const router = useRouter();
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<DisputeRow, { status: string }>('/admin/disputes', {
    status: 'OPEN',
  });
  return (
    <>
      <PageHeader title="Disputes" subtitle="While a dispute is open, the order is frozen and its payment held" />
      <Select
        className="mb-3 max-w-xs"
        value={filters.status}
        onChange={(e) => setFilter('status', e.target.value)}
        options={['', 'OPEN', 'RESOLVED']}
        aria-label="Status"
      />
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(d) => router.push(`/disputes/${d.id}`)}
        empty="No disputes. 🎉"
        columns={[
          { header: 'Order', cell: (d) => d.order.orderNumber },
          {
            header: 'Problem',
            cell: (d) => (
              <div>
                <div className="font-medium">{humanize(d.type)}</div>
                <div className="line-clamp-2 text-xs text-muted">{d.description}</div>
              </div>
            ),
          },
          { header: 'Raised by', cell: (d) => `${fullName(d.raisedBy)} (${d.raisedBy.phone})` },
          { header: 'Value', cell: (d) => `${kes(d.order.total)} · ${humanize(d.order.paymentMethod)}` },
          {
            header: 'Status',
            cell: (d) => (
              <div>
                <Badge status={d.status} />
                {d.outcome && <div className="text-xs text-muted">{humanize(d.outcome)}</div>}
              </div>
            ),
          },
          { header: 'Opened', cell: (d) => dateTime(d.createdAt) },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
