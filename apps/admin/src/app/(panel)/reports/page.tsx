'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BarChart, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { kes } from '@/lib/format';

interface Day {
  date: string;
  revenue: number;
  orders: number;
  completed: number;
  cancelled: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export default function ReportsPage() {
  const { can } = useAuth();
  const [days, setDays] = useState('30');
  const daily = useQuery({ queryKey: ['reports', 'daily', days], queryFn: () => api.get<Day[]>(`/admin/reports/daily?days=${days}`) });
  const categories = useQuery({
    queryKey: ['reports', 'categories', days],
    queryFn: () =>
      api.get<{ slug: string; name: string; orders: number; value: number; revenue: number }[]>(`/admin/reports/categories?days=${days}`),
  });
  const runners = useQuery({
    queryKey: ['reports', 'runners', days],
    queryFn: () =>
      api.get<{ runnerId: string; name: string; phone: string; rating: number; completed: number; earnings: number }[]>(
        `/admin/reports/top-runners?days=${days}`,
      ),
    enabled: can('OPERATIONS_MANAGER', 'RUNNER_MANAGER', 'FINANCE_MANAGER'),
  });
  const totals = daily.data?.reduce(
    (t, d) => ({ revenue: t.revenue + d.revenue, orders: t.orders + d.orders, completed: t.completed + d.completed }),
    { revenue: 0, orders: 0, completed: 0 },
  );

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <Select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
            ]}
            aria-label="Period"
          />
        }
      />
      <ErrorBox error={daily.error ?? categories.error ?? runners.error} />
      {totals && (
        <p className="mb-4 text-sm text-muted">
          {kes(totals.revenue)} revenue · {totals.orders} orders · {totals.completed} completed (
          {totals.orders ? Math.round((totals.completed / totals.orders) * 100) : 0}%)
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Platform revenue per day">
          {daily.data && <BarChart data={daily.data.map((d) => ({ label: d.date, value: d.revenue }))} format={kes} />}
        </Card>
        <Card title="Orders per day">{daily.data && <BarChart data={daily.data.map((d) => ({ label: d.date, value: d.orders }))} />}</Card>
        <Card title="Most ordered errands">
          <Table
            rows={categories.data}
            empty="No orders in this period."
            columns={[
              { header: 'Category', cell: (c) => c.name },
              { header: 'Orders', cell: (c) => c.orders },
              { header: 'Value', cell: (c) => kes(c.value) },
              { header: 'Revenue', cell: (c) => kes(c.revenue) },
            ]}
          />
        </Card>
        {runners.data && (
          <Card title="Best performing runners">
            <Table
              rows={runners.data}
              empty="No completed errands in this period."
              columns={[
                {
                  header: 'Runner',
                  cell: (r) => (
                    <div>
                      {r.name}
                      <div className="text-xs text-muted">{r.phone}</div>
                    </div>
                  ),
                },
                { header: 'Completed', cell: (r) => r.completed },
                { header: 'Earned', cell: (r) => kes(r.earnings) },
                { header: 'Rating', cell: (r) => (r.rating ? `★ ${r.rating}` : '—') },
              ]}
            />
          </Card>
        )}
      </div>
      {can('OPERATIONS_MANAGER', 'FINANCE_MANAGER') && <CsvExport />}
    </>
  );
}

function CsvExport() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const end = new Date(`${to}T23:59:59`);
      const blob = await api.blob(`/admin/reports/orders.csv?from=${new Date(`${from}T00:00:00`).toISOString()}&to=${end.toISOString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `errandconnect-orders-${from}-to-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Export orders (CSV for Excel)">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button onClick={download} loading={busy}>
          Download CSV
        </Button>
      </div>
      <ErrorBox error={error} />
    </Card>
  );
}
