'use client';

import { Badge, Button, ErrorBox, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, fullName } from '@/lib/format';
import { useAction, usePagedList } from '@/lib/hooks';

interface ReviewRow {
  id: string;
  stars: number;
  comment: string | null;
  isHidden: boolean;
  createdAt: string;
  author: { firstName: string; lastName: string };
  subject: { firstName: string; lastName: string } | null;
  order: { orderNumber: string; runnerId: string | null };
  subjectId: string | null;
}

export default function ReviewsPage() {
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<ReviewRow, { maxStars: string; hidden: string }>(
    '/admin/reviews',
    {
      maxStars: '',
      hidden: '',
    },
  );
  const toggle = useAction((r: ReviewRow) => api.post(`/admin/reviews/${r.id}/visibility`, { hidden: !r.isHidden }), [['/admin/reviews']]);

  return (
    <>
      <PageHeader title="Reviews" subtitle="Hidden reviews don't count towards a runner's rating" />
      <div className="mb-3 grid gap-2 sm:grid-cols-[200px_200px]">
        <Select
          value={filters.maxStars}
          onChange={(e) => setFilter('maxStars', e.target.value)}
          options={[
            { value: '', label: 'Any rating' },
            { value: '2', label: '2 stars or fewer' },
            { value: '3', label: '3 stars or fewer' },
          ]}
          aria-label="Rating"
        />
        <Select
          value={filters.hidden}
          onChange={(e) => setFilter('hidden', e.target.value)}
          options={[
            { value: '', label: 'Visible and hidden' },
            { value: 'false', label: 'Visible' },
            { value: 'true', label: 'Hidden' },
          ]}
          aria-label="Visibility"
        />
      </div>
      <ErrorBox error={query.error ?? toggle.error} />
      <Table
        rows={query.data?.items}
        columns={[
          { header: 'Rating', cell: (r) => '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) },
          { header: 'Comment', cell: (r) => r.comment ?? '—' },
          {
            header: 'From → about',
            cell: (r) =>
              `${fullName(r.author)} → ${r.subject ? fullName(r.subject) : '—'} (${r.subjectId === r.order.runnerId ? 'runner' : 'customer'})`,
          },
          { header: 'Order', cell: (r) => r.order.orderNumber },
          { header: 'Status', cell: (r) => <Badge status={r.isHidden ? 'HIDDEN' : 'ACTIVE'} /> },
          { header: 'When', cell: (r) => dateTime(r.createdAt) },
          {
            header: '',
            cell: (r) => (
              <Button variant="secondary" onClick={() => toggle.mutate(r)} loading={toggle.isPending && toggle.variables?.id === r.id}>
                {r.isHidden ? 'Show' : 'Hide'}
              </Button>
            ),
          },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </>
  );
}
