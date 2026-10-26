'use client';

import { useRouter } from 'next/navigation';
import { Badge, ErrorBox, Input, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { date, humanize } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface MerchantRow {
  id: string;
  name: string;
  categorySlug: string;
  addressLine: string | null;
  status: string;
  isFeatured: boolean;
  commissionRate: number | null;
  createdAt: string;
  _count: { orders: number };
}

export default function MerchantsPage() {
  const router = useRouter();
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<MerchantRow, { status: string; search: string }>(
    '/admin/merchants',
    {
      status: '',
      search: '',
    },
  );
  return (
    <>
      <PageHeader title="Shops" subtitle="Merchants customers can order from in the app" />
      <div className="mb-3 grid gap-2 sm:grid-cols-[180px_1fr]">
        <Select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={['', 'PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']}
          aria-label="Status"
        />
        <Input placeholder="Search shop name" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
      </div>
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(m) => router.push(`/merchants/${m.id}`)}
        columns={[
          {
            header: 'Shop',
            cell: (m) => (
              <div>
                <div className="font-medium">
                  {m.name}
                  {m.isFeatured && <span className="ml-2 text-xs text-brand">★ Featured</span>}
                </div>
                <div className="text-xs text-muted">{m.addressLine ?? '—'}</div>
              </div>
            ),
          },
          { header: 'Type', cell: (m) => humanize(m.categorySlug.replace(/-/g, '_')) },
          { header: 'Status', cell: (m) => <Badge status={m.status} /> },
          { header: 'Commission', cell: (m) => (m.commissionRate == null ? 'Default' : `${Math.round(m.commissionRate * 1000) / 10}%`) },
          { header: 'Orders', cell: (m) => m._count.orders },
          { header: 'Joined', cell: (m) => date(m.createdAt) },
        ]}
        empty="No shops match."
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
