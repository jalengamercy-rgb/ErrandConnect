'use client';

import { useRouter } from 'next/navigation';
import { Badge, ErrorBox, Input, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { dateTime, fullName } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface TicketRow {
  id: string;
  number: string;
  subject: string;
  status: string;
  priority: string;
  updatedAt: string;
  user: { firstName: string; lastName: string; phone: string };
  assignedTo: { firstName: string; lastName: string } | null;
  order: { orderNumber: string } | null;
}

export default function TicketsPage() {
  const router = useRouter();
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<
    TicketRow,
    { status: string; assigned: string; search: string }
  >('/admin/tickets', {
    status: 'OPEN',
    assigned: '',
    search: '',
  });
  return (
    <>
      <PageHeader title="Support tickets" subtitle="Most urgent first, then oldest" />
      <div className="mb-3 grid gap-2 sm:grid-cols-[180px_180px_1fr]">
        <Select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={['', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED']}
          aria-label="Status"
        />
        <Select
          value={filters.assigned}
          onChange={(e) => setFilter('assigned', e.target.value)}
          options={[
            { value: '', label: 'Anyone' },
            { value: 'me', label: 'Assigned to me' },
            { value: 'unassigned', label: 'Unassigned' },
          ]}
          aria-label="Assigned"
        />
        <Input placeholder="Search ticket number or subject" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
      </div>
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(t) => router.push(`/tickets/${t.id}`)}
        columns={[
          {
            header: 'Ticket',
            cell: (t) => (
              <div>
                <div className="font-medium">{t.subject}</div>
                <div className="text-xs text-muted">
                  {t.number}
                  {t.order ? ` · ${t.order.orderNumber}` : ''}
                </div>
              </div>
            ),
          },
          { header: 'From', cell: (t) => `${fullName(t.user)} (${t.user.phone})` },
          { header: 'Priority', cell: (t) => <Badge status={t.priority} /> },
          { header: 'Status', cell: (t) => <Badge status={t.status} /> },
          { header: 'Assigned', cell: (t) => (t.assignedTo ? fullName(t.assignedTo) : '—') },
          { header: 'Updated', cell: (t) => dateTime(t.updatedAt) },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
