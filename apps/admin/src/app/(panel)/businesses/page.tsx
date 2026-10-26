'use client';

import { useRouter } from 'next/navigation';
import { Badge, ErrorBox, Input, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { date, humanize, kes } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface BusinessRow {
  id: string;
  name: string;
  industry: string | null;
  companySize: string | null;
  status: string;
  creditLimit: number;
  monthlyInvoicing: boolean;
  createdAt: string;
  _count: { members: number; orders: number };
}

export default function BusinessesPage() {
  const router = useRouter();
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<BusinessRow, { status: string; search: string }>(
    '/admin/businesses',
    {
      status: 'PENDING',
      search: '',
    },
  );
  return (
    <>
      <PageHeader title="Companies" subtitle="Business accounts that order errands for their teams" />
      <div className="mb-3 grid gap-2 sm:grid-cols-[180px_1fr]">
        <Select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={['', 'PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']}
          aria-label="Status"
        />
        <Input
          placeholder="Search company name or registration number"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
        />
      </div>
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(b) => router.push(`/businesses/${b.id}`)}
        columns={[
          {
            header: 'Company',
            cell: (b) => (
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-muted">
                  {[b.industry, b.companySize && humanize(b.companySize.replace('SIZE_', ''))].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            ),
          },
          { header: 'Status', cell: (b) => <Badge status={b.status} /> },
          { header: 'Credit', cell: (b) => (b.monthlyInvoicing ? kes(b.creditLimit) : 'Prepaid') },
          { header: 'Team', cell: (b) => b._count.members },
          { header: 'Orders', cell: (b) => b._count.orders },
          { header: 'Registered', cell: (b) => date(b.createdAt) },
        ]}
        empty="No companies match."
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
