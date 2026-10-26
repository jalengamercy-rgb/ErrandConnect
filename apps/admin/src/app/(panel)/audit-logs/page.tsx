'use client';

import { ErrorBox, Input, PageHeader, Pagination, Table } from '@/components/ui';
import { dateTime, fullName } from '@/lib/format';
import { usePagedList } from '@/lib/hooks';

interface LogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { firstName: string; lastName: string } | null;
}

export default function AuditLogsPage() {
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<LogRow, { entityType: string; entityId: string }>(
    '/admin/audit-logs',
    { entityType: '', entityId: '' },
    50,
  );
  return (
    <>
      <PageHeader title="Activity log" subtitle="Every important admin action, newest first" />
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Type (runner, user, order, dispute, withdrawal, setting…)"
          value={filters.entityType}
          onChange={(e) => setFilter('entityType', e.target.value)}
        />
        <Input placeholder="ID" value={filters.entityId} onChange={(e) => setFilter('entityId', e.target.value)} />
      </div>
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        columns={[
          { header: 'When', cell: (l) => dateTime(l.createdAt), className: 'whitespace-nowrap' },
          { header: 'Who', cell: (l) => (l.actor ? fullName(l.actor) : 'System') },
          { header: 'Action', cell: (l) => <code className="text-xs">{l.action}</code> },
          {
            header: 'On',
            cell: (l) => (
              <span className="text-xs">
                {l.entityType} {l.entityId?.slice(0, 8)}
              </span>
            ),
          },
          {
            header: 'Details',
            cell: (l) =>
              l.metadata ? (
                <code className="block max-w-md truncate text-xs" title={JSON.stringify(l.metadata)}>
                  {JSON.stringify(l.metadata)}
                </code>
              ) : (
                '—'
              ),
          },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
