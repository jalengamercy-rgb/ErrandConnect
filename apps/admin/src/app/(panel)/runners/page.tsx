'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Badge, ErrorBox, Input, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { dateTime, fullName, humanize } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface RunnerRow {
  runnerCode: string;
  applicationStatus: string;
  deliveryTypes: string[];
  area: string | null;
  isOnline: boolean;
  ratingAvg: number;
  jobsCompleted: number;
  submittedAt: string | null;
  user: { id: string; firstName: string; lastName: string; phone: string; status: string };
}

const STATUSES = ['', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];

function RunnersList() {
  const router = useRouter();
  const initial = useSearchParams().get('status') ?? '';
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<RunnerRow, { status: string; search: string }>(
    '/admin/runners',
    {
      status: initial,
      search: '',
    },
  );

  return (
    <>
      <PageHeader title="Runners" subtitle="Applications are listed oldest first so nobody waits too long" />
      <div className="mb-3 grid gap-2 sm:grid-cols-[200px_1fr]">
        <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} options={STATUSES} aria-label="Status" />
        <Input placeholder="Search name, phone or email" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
      </div>
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        onRowClick={(r) => router.push(`/runners/${r.user.id}`)}
        columns={[
          {
            header: 'Runner',
            cell: (r) => (
              <div>
                <div className="font-medium">{fullName(r.user)}</div>
                <div className="text-xs text-muted">
                  {r.runnerCode} · {r.user.phone}
                </div>
              </div>
            ),
          },
          { header: 'Application', cell: (r) => <Badge status={r.applicationStatus} /> },
          { header: 'Account', cell: (r) => <Badge status={r.user.status} /> },
          { header: 'Delivers by', cell: (r) => r.deliveryTypes.map(humanize).join(', ') || '—' },
          { header: 'Area', cell: (r) => r.area ?? '—' },
          { header: 'Online', cell: (r) => (r.isOnline ? '🟢' : '—') },
          { header: 'Jobs / rating', cell: (r) => `${r.jobsCompleted} · ★ ${r.ratingAvg || '—'}` },
          { header: 'Submitted', cell: (r) => dateTime(r.submittedAt) },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}

export default function RunnersPage() {
  return (
    <Suspense>
      <RunnersList />
    </Suspense>
  );
}
