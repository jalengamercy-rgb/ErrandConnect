'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  Badge,
  BarChart,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Stat,
  Table,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, type StaffRole } from '@/lib/auth';
import { dateTime, fullName, humanize, kes } from '@/lib/format';
import { useAction, usePagedList } from '@/lib/hooks';

const TABS: { key: string; label: string; roles: StaffRole[] }[] = [
  { key: 'risk', label: 'Risk', roles: ['OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'CUSTOMER_SUPPORT', 'RUNNER_MANAGER'] },
  { key: 'demand', label: 'Demand', roles: ['OPERATIONS_MANAGER', 'RUNNER_MANAGER', 'MARKETING_MANAGER'] },
  { key: 'delivery', label: 'Delivery times', roles: ['OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT', 'RUNNER_MANAGER'] },
  { key: 'churn', label: 'Churn', roles: ['MARKETING_MANAGER', 'OPERATIONS_MANAGER', 'RUNNER_MANAGER'] },
];

export default function InsightsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabs = TABS.filter((t) => can(...t.roles));
  const tab = tabs.find((t) => t.key === params.get('tab'))?.key ?? tabs[0]?.key;

  return (
    <>
      <PageHeader title="Insights" subtitle="Fraud and risk checks, and predictions learnt from ErrandCONNECT's own data" />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => router.replace(`${pathname}?tab=${t.key}`)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'risk' && <Risk />}
      {tab === 'demand' && <Demand />}
      {tab === 'delivery' && <DeliveryTimes />}
      {tab === 'churn' && <Churn />}
    </>
  );
}

// ─── Risk ───

interface Flag {
  id: string;
  rule: string;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  status: string;
  score: number;
  summary: string;
  createdAt: string;
  reviewNote: string | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    status: string;
    runnerProfile: { runnerCode: string } | null;
  } | null;
  order: { id: string; orderNumber: string } | null;
  reviewedBy: { firstName: string; lastName: string } | null;
}

const SEVERITY_STYLE = {
  HIGH: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  MEDIUM: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  LOW: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
} as const;

function Severity({ level }: { level: Flag['severity'] }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[level]}`}>{humanize(level)}</span>;
}

function Risk() {
  const { can } = useAuth();
  const canReview = can('OPERATIONS_MANAGER', 'FINANCE_MANAGER');
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<Flag, { status: string; severity: string }>(
    '/admin/insights/risk-flags',
    {
      status: 'OPEN',
      severity: '',
    },
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const review = useAction(
    (b: { id: string; decision: 'CONFIRMED' | 'DISMISSED' }) =>
      api.post(`/admin/insights/risk-flags/${b.id}/review`, { decision: b.decision, note: notes[b.id] || undefined }),
    [['/admin/insights/risk-flags']],
  );
  const scan = useAction(() => api.post<{ findings: number }>('/admin/insights/risk/scan'), [['/admin/insights/risk-flags']]);

  return (
    <>
      <div className="mb-3 grid items-center gap-2 sm:grid-cols-[180px_180px_auto_1fr]">
        <Select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={['OPEN', 'CONFIRMED', 'DISMISSED', '']}
          aria-label="Status"
        />
        <Select
          value={filters.severity}
          onChange={(e) => setFilter('severity', e.target.value)}
          options={[
            { value: '', label: 'Any severity' },
            { value: 'HIGH', label: 'High' },
            { value: 'MEDIUM', label: 'Medium' },
            { value: 'LOW', label: 'Low' },
          ]}
          aria-label="Severity"
        />
        {canReview && (
          <Button variant="secondary" onClick={() => scan.mutate()} loading={scan.isPending}>
            Run checks now
          </Button>
        )}
        {scan.isSuccess && <span className="text-sm text-muted">{scan.data.findings} findings</span>}
      </div>
      <p className="mb-3 text-sm text-muted">
        Checks run every hour and when errands are placed or delivered. A flag is a reason to look, not proof. While a <b>high</b> flag is
        open, the person&apos;s withdrawals wait for finance approval.
      </p>
      <ErrorBox error={query.error ?? review.error ?? scan.error} />
      <Table
        rows={query.data?.items}
        columns={[
          {
            header: 'Finding',
            cell: (f) => (
              <div className="max-w-md">
                <div className="font-medium">{f.title}</div>
                <div className="text-xs text-muted">{f.summary}</div>
              </div>
            ),
          },
          { header: 'Severity', cell: (f) => <Severity level={f.severity} /> },
          {
            header: 'Who',
            cell: (f) =>
              f.user ? (
                <Link
                  className="text-brand hover:underline"
                  href={f.user.runnerProfile ? `/runners/${f.user.id}` : `/customers/${f.user.id}`}
                >
                  {fullName(f.user)}
                  <div className="text-xs text-muted">
                    {f.user.runnerProfile ? `Runner ${f.user.runnerProfile.runnerCode}` : 'Customer'} · {humanize(f.user.status)}
                  </div>
                </Link>
              ) : (
                '—'
              ),
          },
          {
            header: 'Errand',
            cell: (f) =>
              f.order ? (
                <Link className="text-brand hover:underline" href={`/orders/${f.order.id}`}>
                  {f.order.orderNumber}
                </Link>
              ) : (
                '—'
              ),
          },
          { header: 'Found', cell: (f) => dateTime(f.createdAt) },
          {
            header: 'Review',
            cell: (f) =>
              f.status !== 'OPEN' ? (
                <div className="text-xs">
                  {f.status === 'CONFIRMED' ? 'Confirmed' : 'Dismissed'} {f.reviewedBy ? `by ${fullName(f.reviewedBy)}` : ''}
                  {f.reviewNote && <div className="text-muted">{f.reviewNote}</div>}
                </div>
              ) : canReview ? (
                <div className="flex min-w-48 flex-col gap-1">
                  <Input
                    placeholder="Note (optional)"
                    value={notes[f.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                  />
                  <div className="flex gap-1">
                    <Button variant="danger" onClick={() => review.mutate({ id: f.id, decision: 'CONFIRMED' })}>
                      Confirm
                    </Button>
                    <Button variant="ghost" onClick={() => review.mutate({ id: f.id, decision: 'DISMISSED' })}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              ) : (
                'Open'
              ),
          },
        ]}
        empty="Nothing to review."
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
      <p className="mt-3 text-xs text-muted">
        Confirming records the decision. To stop someone using the app, suspend them from their customer or runner page.
      </p>
    </>
  );
}

// ─── Demand ───

interface Demand {
  basedOnWeeks: number;
  historyErrands: number;
  onlineRunners: number;
  expectedTotal: number;
  forecast: { at: string; expected: number; runnersNeeded: number }[];
  hotspots: {
    key: string;
    name: string;
    lat: number;
    lng: number;
    expectedPerHour: number;
    runnersNeeded: number;
    runnersOnline: number;
    shortfall: number;
  }[];
  topCategories: { slug: string; name: string; share: number }[];
}

const hourLabel = (iso: string) => new Date(iso).toLocaleString('en-KE', { weekday: 'short', hour: 'numeric' });

function Demand() {
  const [hours, setHours] = useState('24');
  const { data, error } = useQuery({
    queryKey: ['/admin/insights/demand', hours],
    queryFn: () => api.get<Demand>(`/admin/insights/demand?hours=${hours}`),
    refetchInterval: 5 * 60_000,
  });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const peak = data.forecast.reduce((p, f) => (f.expected > p.expected ? f : p), data.forecast[0]);
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Errands expected, next ${hours} h`} value={data.expectedTotal} />
        <Stat
          label="Busiest hour"
          value={peak && peak.expected > 0 ? hourLabel(peak.at) : '—'}
          hint={peak ? `${peak.expected} errands, ${peak.runnersNeeded} runners` : undefined}
        />
        <Stat
          label="Runners online now"
          value={data.onlineRunners}
          tone={data.forecast[0] && data.onlineRunners < data.forecast[0].runnersNeeded ? 'warning' : undefined}
        />
        <Stat label="Learnt from" value={data.historyErrands} hint={`errands in the last ${data.basedOnWeeks} weeks`} />
      </div>
      {data.historyErrands < 200 && (
        <div className="mb-4">
          <Notice>Forecasts get better with history. With fewer than a few hundred past errands, treat these as rough guides.</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title="Errands expected per hour"
            actions={
              <Select
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                options={[
                  { value: '12', label: 'Next 12 hours' },
                  { value: '24', label: 'Next 24 hours' },
                  { value: '72', label: 'Next 3 days' },
                ]}
                aria-label="Hours"
              />
            }
          >
            {data.expectedTotal > 0 ? (
              <BarChart data={data.forecast.map((f) => ({ label: hourLabel(f.at), value: f.expected }))} />
            ) : (
              <p className="py-12 text-center text-sm text-muted">
                No errands were placed at these hours in the last {data.basedOnWeeks} weeks.
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              From the same hour on the same weekday over the last {data.basedOnWeeks} weeks (recent weeks count more).
            </p>
          </Card>
        </div>
        <Card title="Most likely errands">
          <Table
            rows={data.topCategories}
            columns={[
              { header: 'Errand type', cell: (c) => c.name },
              { header: 'Share', cell: (c) => `${c.share}%` },
            ]}
            empty="No errands at these hours in past weeks."
          />
        </Card>
      </div>
      <div className="mt-4">
        <Card title="Where runners are needed in the next 3 hours">
          <Table
            rows={data.hotspots}
            columns={[
              {
                header: 'Area',
                cell: (h) => (
                  <a
                    className="text-brand hover:underline"
                    href={`https://www.google.com/maps?q=${h.lat},${h.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Around {h.name}
                  </a>
                ),
              },
              { header: 'Errands / hour', cell: (h) => h.expectedPerHour },
              { header: 'Runners needed', cell: (h) => h.runnersNeeded },
              { header: 'Online now', cell: (h) => h.runnersOnline },
              { header: 'Short by', cell: (h) => (h.shortfall > 0 ? <b className="text-danger">{h.shortfall}</b> : '—') },
            ]}
            empty="No busy areas expected."
          />
          <p className="mt-2 text-xs text-muted">Areas are about 2 km squares. A runner handles about 1.5 errands an hour.</p>
        </Card>
      </div>
    </>
  );
}

// ─── Delivery times ───

interface EtaModel {
  intercept: number;
  perKm: number;
  samples: number;
}
interface LateErrand {
  id: string;
  orderNumber: string;
  status: string;
  predictedMinutes: number;
  elapsedMinutes: number;
  minutesLate: number;
  customer: { firstName: string; lastName: string; phone: string };
  runner: { id: string; firstName: string; lastName: string; phone: string } | null;
}

function DeliveryTimes() {
  const { data, error } = useQuery({
    queryKey: ['/admin/insights/delivery-times'],
    queryFn: () => api.get<{ models: Record<string, EtaModel>; late: LateErrand[] }>('/admin/insights/delivery-times'),
    refetchInterval: 60_000,
  });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title={`Running late now (${data.late.length})`}>
        <Table
          rows={data.late}
          columns={[
            {
              header: 'Errand',
              cell: (o) => (
                <Link className="text-brand hover:underline" href={`/orders/${o.id}`}>
                  {o.orderNumber}
                </Link>
              ),
            },
            { header: 'Status', cell: (o) => <Badge status={o.status} /> },
            { header: 'Expected', cell: (o) => `${o.predictedMinutes} min` },
            { header: 'So far', cell: (o) => `${o.elapsedMinutes} min` },
            { header: 'Late by', cell: (o) => <b className="text-danger">{o.minutesLate} min</b> },
            { header: 'Runner', cell: (o) => (o.runner ? `${fullName(o.runner)} · ${o.runner.phone}` : '—') },
            { header: 'Customer', cell: (o) => `${fullName(o.customer)} · ${o.customer.phone}` },
          ]}
          empty="Every errand in progress is on time."
        />
      </Card>
      <Card title="How long errands take (minutes after the runner accepts)">
        <Table
          rows={Object.entries(data.models)}
          columns={[
            { header: 'Vehicle', cell: ([type]) => humanize(type) },
            { header: 'Fixed time', cell: ([, m]) => `${Math.round(m.intercept)} min` },
            { header: 'Per km', cell: ([, m]) => `${m.perKm} min` },
            { header: '5 km errand', cell: ([, m]) => `${Math.max(5, Math.round(m.intercept + m.perKm * 5))} min` },
            { header: 'Learnt from', cell: ([, m]) => (m.samples ? `${m.samples} errands` : 'Typical speeds (not enough history yet)') },
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          Customers see an expected arrival time once a runner accepts. An errand counts as late when it takes 30% (and at least 10 minutes)
          longer than expected.
        </p>
      </Card>
    </div>
  );
}

// ─── Churn ───

interface ChurnCustomer {
  userId: string;
  name: string;
  phone: string;
  orders: number;
  lifetimeSpend: number;
  daysSinceLast: number;
  usualGapDays: number | null;
  risk: 'AT_RISK' | 'LIKELY_LOST' | 'LOST';
}
interface InactiveRunner {
  userId: string;
  name: string;
  phone: string;
  jobsLast60Days: number;
  daysSinceLast: number;
}

const RISK_BADGE = { AT_RISK: 'PENDING', LIKELY_LOST: 'REJECTED', LOST: 'CLOSED' } as const;

function Churn() {
  const { can } = useAuth();
  const canSeeCustomers = can('MARKETING_MANAGER', 'OPERATIONS_MANAGER');
  const [who, setWho] = useState<'customers' | 'runners'>(canSeeCustomers ? 'customers' : 'runners');
  const [risk, setRisk] = useState('AT_RISK');
  const customers = useQuery({
    queryKey: ['/admin/insights/churn/customers', risk],
    queryFn: () =>
      api.get<{ counts: Record<string, number>; items: ChurnCustomer[] }>(`/admin/insights/churn/customers${risk ? `?risk=${risk}` : ''}`),
    enabled: who === 'customers',
  });
  const runners = useQuery({
    queryKey: ['/admin/insights/churn/runners'],
    queryFn: () => api.get<InactiveRunner[]>('/admin/insights/churn/runners'),
    enabled: who === 'runners',
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = who === 'customers' ? (customers.data?.items ?? []) : (runners.data ?? []);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.userId));
  const select = (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={allSelected}
      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.userId)))}
    />
  );

  return (
    <>
      <div className="mb-3 grid gap-2 sm:grid-cols-[180px_220px]">
        <Select
          value={who}
          onChange={(e) => {
            setWho(e.target.value as 'customers' | 'runners');
            setSelected(new Set());
          }}
          options={[...(canSeeCustomers ? [{ value: 'customers', label: 'Customers' }] : []), { value: 'runners', label: 'Runners' }]}
          aria-label="Who"
        />
        {who === 'customers' && (
          <Select
            value={risk}
            onChange={(e) => {
              setRisk(e.target.value);
              setSelected(new Set());
            }}
            options={[
              { value: 'AT_RISK', label: `At risk${customers.data ? ` (${customers.data.counts.AT_RISK})` : ''}` },
              { value: 'LIKELY_LOST', label: `Likely lost${customers.data ? ` (${customers.data.counts.LIKELY_LOST})` : ''}` },
              { value: 'LOST', label: `Lost, 90+ days${customers.data ? ` (${customers.data.counts.LOST})` : ''}` },
            ]}
            aria-label="Risk"
          />
        )}
      </div>
      <p className="mb-3 text-sm text-muted">
        {who === 'customers'
          ? 'Customers compared with their own rhythm: at risk after twice their usual gap between errands, likely lost after four times. Most valuable first.'
          : 'Runners who did at least 5 jobs in the last 60 days but none in the last 14.'}
      </p>
      <ErrorBox error={customers.error ?? runners.error} />
      {who === 'customers' ? (
        <Table
          rows={customers.data?.items}
          columns={[
            {
              header: '',
              cell: (c) => (
                <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.userId)} onChange={() => toggle(c.userId)} />
              ),
            },
            {
              header: 'Customer',
              cell: (c) => (
                <Link className="text-brand hover:underline" href={`/customers/${c.userId}`}>
                  {c.name}
                  <div className="text-xs text-muted">{c.phone}</div>
                </Link>
              ),
            },
            { header: 'Errands', cell: (c) => c.orders },
            { header: 'Spent', cell: (c) => kes(c.lifetimeSpend) },
            { header: 'Last errand', cell: (c) => `${c.daysSinceLast} days ago` },
            { header: 'Usually every', cell: (c) => (c.usualGapDays === null ? 'One errand' : `${c.usualGapDays} days`) },
            { header: 'Risk', cell: (c) => <Badge status={RISK_BADGE[c.risk]} /> },
          ]}
          empty="Nobody in this group."
        />
      ) : (
        <Table
          rows={runners.data}
          columns={[
            {
              header: '',
              cell: (r) => (
                <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.userId)} onChange={() => toggle(r.userId)} />
              ),
            },
            {
              header: 'Runner',
              cell: (r) => (
                <Link className="text-brand hover:underline" href={`/runners/${r.userId}`}>
                  {r.name}
                  <div className="text-xs text-muted">{r.phone}</div>
                </Link>
              ),
            },
            { header: 'Jobs (60 days)', cell: (r) => r.jobsLast60Days },
            { header: 'Last job', cell: (r) => `${r.daysSinceLast} days ago` },
          ]}
          empty="No inactive runners."
        />
      )}
      {rows.length > 0 && <div className="mt-2 text-sm">{select} Select all</div>}
      {selected.size > 0 && <WinBack userIds={[...selected]} who={who} onSent={() => setSelected(new Set())} />}
    </>
  );
}

function WinBack({ userIds, who, onSent }: { userIds: string[]; who: 'customers' | 'runners'; onSent: () => void }) {
  const [title, setTitle] = useState(who === 'customers' ? 'We miss you!' : 'Jobs are waiting near you');
  const [message, setMessage] = useState(
    who === 'customers'
      ? 'It has been a while. Let a runner handle your next errand.'
      : 'Customers near you need runners. Go online to see jobs.',
  );
  const [promoCode, setPromoCode] = useState('');
  const send = useAction(async () => {
    const result = await api.post<{ sent: number }>('/admin/insights/churn/win-back', {
      userIds,
      title,
      message,
      promoCode: promoCode || undefined,
    });
    onSent();
    return result;
  });
  return (
    <div className="mt-4">
      <Card title={`Send a message to ${userIds.length} ${who === 'customers' ? 'customer' : 'runner'}${userIds.length === 1 ? '' : 's'}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </Field>
          {who === 'customers' && (
            <Field label="Promo code to include" hint="Optional; create it on the Promotions page first">
              <Input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Message (app inbox)">
              <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </div>
        <div className="mt-3">
          <ErrorBox error={send.error} />
          <Button disabled={title.trim().length < 3 || message.trim().length < 5} onClick={() => send.mutate()} loading={send.isPending}>
            Send
          </Button>
        </div>
      </Card>
      {send.isSuccess && <Notice>Sent to {send.data.sent} people.</Notice>}
    </div>
  );
}
