'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, PageHeader, Pagination, Select, Stat, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, fullName, humanize, kes } from '@/lib/format';
import { useAction, usePagedList } from '@/lib/hooks';

interface Summary {
  platformRevenue: number;
  escrowHeld: number;
  payoutsPending: number;
  customerWallets: number;
  runnerWallets: number;
  mpesaFloat: number;
}

interface WithdrawalRow {
  id: string;
  amount: number;
  method: string;
  status: string;
  destination: { phone?: string; bankName?: string; accountNumber?: string; accountName?: string };
  note: string | null;
  providerReceipt: string | null;
  createdAt: string;
  wallet: { type: string; user: { firstName: string; lastName: string; phone: string } };
}

interface PaymentRow {
  id: string;
  amount: number;
  status: string;
  phone: string | null;
  providerReceipt: string | null;
  failureReason: string | null;
  createdAt: string;
  order: { orderNumber: string } | null;
}

interface EscrowRow {
  id: string;
  amount: number;
  status: string;
  heldAt: string;
  releasedAt: string | null;
  order: { orderNumber: string; status: string };
}

export default function FinancePage() {
  const [tab, setTab] = useState<'withdrawals' | 'payments' | 'escrow'>('withdrawals');
  const summary = useQuery({ queryKey: ['/admin/finance/summary'], queryFn: () => api.get<Summary>('/admin/finance/summary') });
  const s = summary.data;

  return (
    <>
      <PageHeader title="Finance" />
      <ErrorBox error={summary.error} />
      {s && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Platform revenue" value={kes(s.platformRevenue)} />
          <Stat label="Held in escrow" value={kes(s.escrowHeld)} />
          <Stat label="Payouts in progress" value={kes(s.payoutsPending)} />
          <Stat label="Customer wallets" value={kes(s.customerWallets)} />
          <Stat label="Runner wallets" value={kes(s.runnerWallets)} hint="Negative = runners owe cash-errand fees" />
          <Stat
            label="M-Pesa float (expected)"
            value={kes(s.mpesaFloat)}
            hint="Received minus paid out; reconcile with the M-Pesa statement"
          />
        </div>
      )}
      <div className="mb-4 flex gap-2">
        {(['withdrawals', 'payments', 'escrow'] as const).map((t) => (
          <Button key={t} variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
            {humanize(t)}
          </Button>
        ))}
      </div>
      {tab === 'withdrawals' && <Withdrawals />}
      {tab === 'payments' && <Payments />}
      {tab === 'escrow' && <Escrows />}
    </>
  );
}

function Withdrawals() {
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<WithdrawalRow, { status: string }>('/admin/withdrawals', {
    status: 'REQUESTED',
  });
  const refresh = [['/admin/withdrawals'], ['/admin/finance/summary']];
  const approve = useAction((id: string) => api.post(`/admin/withdrawals/${id}/approve`), refresh);
  const reject = useAction(
    (b: { id: string; reason: string }) => api.post(`/admin/withdrawals/${b.id}/reject`, { reason: b.reason }),
    refresh,
  );
  const markPaid = useAction(
    (b: { id: string; reference: string }) => api.post(`/admin/withdrawals/${b.id}/mark-paid`, { reference: b.reference }),
    refresh,
  );

  return (
    <Card>
      <Select
        className="mb-3 max-w-xs"
        value={filters.status}
        onChange={(e) => setFilter('status', e.target.value)}
        options={['', 'REQUESTED', 'APPROVED', 'PAID', 'ON_HOLD', 'FAILED', 'REJECTED']}
        aria-label="Status"
      />
      <ErrorBox error={query.error ?? approve.error ?? reject.error ?? markPaid.error} />
      <Table
        rows={query.data?.items}
        columns={[
          {
            header: 'Who',
            cell: (w) => (
              <div>
                {fullName(w.wallet.user)}
                <div className="text-xs text-muted">{humanize(w.wallet.type)} wallet</div>
              </div>
            ),
          },
          { header: 'Amount', cell: (w) => kes(w.amount) },
          {
            header: 'To',
            cell: (w) =>
              w.method === 'BANK' ? `${w.destination.bankName} ${w.destination.accountNumber}` : `M-Pesa ${w.destination.phone}`,
          },
          {
            header: 'Status',
            cell: (w) => (
              <div>
                <Badge status={w.status} />
                {w.note && <div className="text-xs text-muted">{w.note}</div>}
              </div>
            ),
          },
          { header: 'Requested', cell: (w) => dateTime(w.createdAt) },
          {
            header: '',
            cell: (w) =>
              w.status === 'REQUESTED' && (
                <div className="flex flex-wrap gap-1">
                  {w.method === 'MPESA' ? (
                    <Button onClick={() => approve.mutate(w.id)} loading={approve.isPending && approve.variables === w.id}>
                      Approve & pay
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        const reference = window.prompt('Bank transfer reference');
                        if (reference && reference.trim().length >= 3) markPaid.mutate({ id: w.id, reference: reference.trim() });
                      }}
                    >
                      Mark paid
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const reason = window.prompt('Why is this withdrawal rejected? (the money goes back to their wallet)');
                      if (reason && reason.trim().length >= 3) reject.mutate({ id: w.id, reason: reason.trim() });
                    }}
                  >
                    Reject
                  </Button>
                </div>
              ),
          },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </Card>
  );
}

function Payments() {
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<PaymentRow, { status: string; search: string }>(
    '/admin/payments',
    { status: '', search: '' },
  );
  return (
    <Card>
      <Select
        className="mb-3 max-w-xs"
        value={filters.status}
        onChange={(e) => setFilter('status', e.target.value)}
        options={['', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED']}
        aria-label="Status"
      />
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        columns={[
          { header: 'Order', cell: (p) => p.order?.orderNumber ?? '—' },
          { header: 'Amount', cell: (p) => kes(p.amount) },
          { header: 'Phone', cell: (p) => p.phone ?? '—' },
          { header: 'Receipt', cell: (p) => p.providerReceipt ?? '—' },
          {
            header: 'Status',
            cell: (p) => (
              <div>
                <Badge status={p.status} />
                {p.failureReason && <div className="text-xs text-muted">{p.failureReason}</div>}
              </div>
            ),
          },
          { header: 'When', cell: (p) => dateTime(p.createdAt) },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </Card>
  );
}

function Escrows() {
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<EscrowRow, { status: string }>('/admin/escrows', {
    status: 'HELD',
  });
  return (
    <Card>
      <Select
        className="mb-3 max-w-xs"
        value={filters.status}
        onChange={(e) => setFilter('status', e.target.value)}
        options={['', 'HELD', 'ON_HOLD', 'RELEASED', 'REFUNDED']}
        aria-label="Status"
      />
      <ErrorBox error={query.error} />
      <Table
        rows={query.data?.items}
        columns={[
          { header: 'Order', cell: (e) => e.order.orderNumber },
          { header: 'Order status', cell: (e) => <Badge status={e.order.status} /> },
          { header: 'Amount', cell: (e) => kes(e.amount) },
          { header: 'Escrow', cell: (e) => <Badge status={e.status} /> },
          { header: 'Held', cell: (e) => dateTime(e.heldAt) },
          { header: 'Released', cell: (e) => dateTime(e.releasedAt) },
        ]}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}
    </Card>
  );
}
