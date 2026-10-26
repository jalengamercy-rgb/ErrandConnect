'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BarChart, Card, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { kes } from '@/lib/format';

interface Dashboard {
  revenue: { total: number; today: number };
  escrowHeld: number;
  customers: { total: number; activeLast30Days: number; verified: number };
  runners: { total: number; online: number; offline: number; suspended: number; pendingApproval: number };
  orders: { today: number; active: number; scheduled: number; completed: number; cancelled: number; disputed: number };
  avgDeliveryMinutes: number | null;
  avgRunnerRating: number | null;
  walletBalances: { customers: number; runners: number };
  pendingWithdrawals: { count: number; amount: number };
  openDisputes: number;
  openTickets: number;
}

export default function DashboardPage() {
  const { can } = useAuth();
  const { data, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/admin/dashboard'),
    refetchInterval: 30_000,
  });
  const daily = useQuery({
    queryKey: ['reports', 'daily', 14],
    queryFn: () => api.get<{ date: string; revenue: number; orders: number }[]>('/admin/reports/daily?days=14'),
    enabled: can('OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'MARKETING_MANAGER'),
  });

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Updates every 30 seconds" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Platform revenue" value={kes(data.revenue.total)} hint={`${kes(data.revenue.today)} today`} />
        <Stat label="Held in escrow" value={kes(data.escrowHeld)} />
        <Stat
          label="Active orders"
          value={data.orders.active}
          hint={`${data.orders.today} placed today · ${data.orders.scheduled} scheduled`}
        />
        <Stat
          label="Runners online"
          value={data.runners.online}
          hint={`${data.runners.offline} offline · ${data.runners.total} registered`}
        />
        <Stat
          label="Customers"
          value={data.customers.total}
          hint={`${data.customers.activeLast30Days} active (30 days) · ${data.customers.verified} ID-verified`}
        />
        <Stat label="Completed orders" value={data.orders.completed} hint={`${data.orders.cancelled} cancelled`} />
        <Stat
          label="Avg delivery time"
          value={data.avgDeliveryMinutes !== null ? `${data.avgDeliveryMinutes} min` : '—'}
          hint="Last 30 days"
        />
        <Stat label="Avg runner rating" value={data.avgRunnerRating !== null ? `★ ${data.avgRunnerRating}` : '—'} />
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Needs attention</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/runners?status=SUBMITTED">
          <Stat
            label="Runner applications"
            value={data.runners.pendingApproval}
            tone={data.runners.pendingApproval ? 'warning' : undefined}
          />
        </Link>
        <Link href="/disputes">
          <Stat
            label="Open disputes"
            value={data.openDisputes}
            tone={data.openDisputes ? 'danger' : undefined}
            hint={`${data.orders.disputed} order${data.orders.disputed === 1 ? '' : 's'} on hold`}
          />
        </Link>
        <Link href="/tickets">
          <Stat label="Open tickets" value={data.openTickets} tone={data.openTickets ? 'warning' : undefined} />
        </Link>
        <Link href="/finance">
          <Stat
            label="Withdrawals to approve"
            value={data.pendingWithdrawals.count}
            hint={kes(data.pendingWithdrawals.amount)}
            tone={data.pendingWithdrawals.count ? 'warning' : undefined}
          />
        </Link>
      </div>

      {daily.data && (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card title="Revenue, last 14 days">
            <BarChart data={daily.data.map((d) => ({ label: d.date, value: d.revenue }))} format={kes} />
          </Card>
          <Card title="Orders, last 14 days">
            <BarChart data={daily.data.map((d) => ({ label: d.date, value: d.orders }))} />
          </Card>
        </div>
      )}
      <p className="mt-6 text-xs text-muted">
        Wallet balances: customers {kes(data.walletBalances.customers)} · runners {kes(data.walletBalances.runners)} · suspended runners{' '}
        {data.runners.suspended}
      </p>
    </>
  );
}
