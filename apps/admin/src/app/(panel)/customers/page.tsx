'use client';

import { useRouter } from 'next/navigation';
import { Badge, ErrorBox, Input, PageHeader, Pagination, Table } from '@/components/ui';
import { date, fullName, kes } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface CustomerRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: string;
  createdAt: string;
  customerProfile: { customerCode: string; verificationLevel: number };
  wallets: { balance: number }[];
  _count: { ordersAsCustomer: number };
}

export default function CustomersPage() {
  const router = useRouter();
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<CustomerRow, { search: string }>('/admin/customers', {
    search: '',
  });

  return (
    <>
      <PageHeader title="Customers" />
      <Input
        className="mb-3"
        placeholder="Search name, phone or email"
        value={filters.search}
        onChange={(e) => setFilter('search', e.target.value)}
      />
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(c) => router.push(`/customers/${c.id}`)}
        columns={[
          {
            header: 'Customer',
            cell: (c) => (
              <div>
                <div className="font-medium">{fullName(c)}</div>
                <div className="text-xs text-muted">{c.customerProfile.customerCode}</div>
              </div>
            ),
          },
          { header: 'Phone', cell: (c) => c.phone },
          { header: 'Email', cell: (c) => c.email ?? '—' },
          {
            header: 'Level',
            cell: (c) => (c.customerProfile.verificationLevel === 3 ? '🟢 Verified' : `Level ${c.customerProfile.verificationLevel}`),
          },
          { header: 'Orders', cell: (c) => c._count.ordersAsCustomer },
          { header: 'Wallet', cell: (c) => kes(c.wallets[0]?.balance) },
          { header: 'Status', cell: (c) => <Badge status={c.status} /> },
          { header: 'Joined', cell: (c) => date(c.createdAt) },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
