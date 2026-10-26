'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DocumentPreview } from '@/components/document-preview';
import { Badge, Button, Card, ErrorBox, Field, Input, KeyValue, Loading, PageHeader, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, fullName, humanize, kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Business {
  id: string;
  name: string;
  businessType: string | null;
  industry: string | null;
  registrationNumber: string | null;
  kraPin: string | null;
  vatNumber: string | null;
  yearsInBusiness: number | null;
  companySize: string | null;
  estMonthlyOrders: string | null;
  servicesNeeded: string[];
  requestedFeatures: string[];
  billingEmail: string | null;
  creditLimit: number;
  monthlyInvoicing: boolean;
  status: string;
  createdAt: string;
  creditUsed: number;
  completedSpend: number;
  members: {
    userId: string;
    role: string;
    position: string | null;
    approvalLimit: number | null;
    user: { id: string; firstName: string; lastName: string; phone: string };
  }[];
  addresses: { id: string; label: string; building: string | null; area: string | null; city: string | null }[];
  invoices: { id: string; number: string; amount: number; status: string; dueDate: string }[];
  documents: { id: string; type: string; status: string; mimeType: string }[];
  _count: { orders: number };
}

export default function BusinessPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const key = ['/admin/businesses', id];
  const { data: b, error } = useQuery({ queryKey: key, queryFn: () => api.get<Business>(`/admin/businesses/${id}`) });
  const refresh = [key, ['/admin/businesses']];
  const [credit, setCredit] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const approve = useAction(
    () =>
      api.post(
        `/admin/businesses/${id}/approve`,
        can('FINANCE_MANAGER')
          ? { creditLimit: Number(credit ?? b?.creditLimit ?? 0), monthlyInvoicing: invoicing ?? b?.monthlyInvoicing ?? false }
          : {},
      ),
    refresh,
  );
  const save = useAction(
    () =>
      api.patch(`/admin/businesses/${id}`, {
        creditLimit: Number(credit ?? b?.creditLimit ?? 0),
        monthlyInvoicing: invoicing ?? b?.monthlyInvoicing,
      }),
    refresh,
  );
  const reject = useAction(() => api.post(`/admin/businesses/${id}/reject`, { reason }), refresh);
  const suspend = useAction(() => api.post(`/admin/businesses/${id}/suspend`, { reason }), refresh);
  const reviewDoc = useAction(
    (b: { docId: string; decision: 'APPROVED' | 'REJECTED' }) =>
      api.post(`/admin/documents/${b.docId}/review`, {
        decision: b.decision,
        reason: b.decision === 'REJECTED' ? 'Document could not be verified' : undefined,
      }),
    refresh,
  );

  if (error) return <ErrorBox error={error} />;
  if (!b) return <Loading />;
  const creditValue = credit ?? String(b.creditLimit);
  const invoicingValue = invoicing ?? b.monthlyInvoicing;
  const isFinance = can('FINANCE_MANAGER');

  return (
    <>
      <PageHeader
        title={b.name}
        subtitle={`Registered ${date(b.createdAt)} · ${b._count.orders} orders · ${kes(b.completedSpend)} spent`}
        actions={<Badge status={b.status} />}
      />
      <ErrorBox error={approve.error ?? save.error ?? reject.error ?? suspend.error ?? reviewDoc.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Company details">
            <KeyValue
              items={[
                ['Type', b.businessType ?? '—'],
                ['Industry', b.industry ?? '—'],
                ['Registration no.', b.registrationNumber ?? '—'],
                ['KRA PIN', b.kraPin ?? '—'],
                ['VAT no.', b.vatNumber ?? '—'],
                ['Years in business', b.yearsInBusiness ?? '—'],
                ['Size', b.companySize ? humanize(b.companySize.replace('SIZE_', '')) + ' staff' : '—'],
                ['Expected orders / month', b.estMonthlyOrders ? humanize(b.estMonthlyOrders) : '—'],
                ['Services needed', b.servicesNeeded.map(humanize).join(', ') || '—'],
                ['Asked for', b.requestedFeatures.map(humanize).join(', ') || '—'],
                ['Billing email', b.billingEmail ?? '—'],
              ]}
            />
          </Card>
          <Card title={`Team (${b.members.length})`}>
            <Table
              rows={b.members}
              columns={[
                {
                  header: 'Name',
                  cell: (m) => (
                    <Link className="text-brand hover:underline" href={`/customers/${m.user.id}`}>
                      {fullName(m.user)}
                    </Link>
                  ),
                },
                { header: 'Phone', cell: (m) => m.user.phone },
                { header: 'Role', cell: (m) => humanize(m.role) },
                { header: 'Position', cell: (m) => m.position ?? '—' },
                { header: 'Needs approval above', cell: (m) => (m.approvalLimit == null ? '—' : kes(m.approvalLimit)) },
              ]}
            />
          </Card>
          <Card title="Branches">
            <Table
              rows={b.addresses}
              columns={[
                { header: 'Label', cell: (a) => a.label },
                { header: 'Location', cell: (a) => [a.building, a.area, a.city].filter(Boolean).join(', ') || '—' },
              ]}
              empty="No branches added yet."
            />
          </Card>
          <Card title="Recent invoices">
            <Table
              rows={b.invoices}
              columns={[
                {
                  header: 'Invoice',
                  cell: (i) => (
                    <Link className="text-brand hover:underline" href={`/invoices/${i.id}`}>
                      {i.number}
                    </Link>
                  ),
                },
                { header: 'Amount', cell: (i) => kes(i.amount) },
                { header: 'Status', cell: (i) => <Badge status={i.status} /> },
                { header: 'Due', cell: (i) => date(i.dueDate) },
              ]}
              empty="No invoices yet."
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Credit and billing">
            <KeyValue
              items={[
                ['Credit used', kes(b.creditUsed)],
                ['Credit limit', kes(b.creditLimit)],
                ['Monthly invoicing', b.monthlyInvoicing ? 'Yes' : 'No'],
              ]}
            />
            {isFinance && (
              <div className="mt-3 space-y-3">
                <Field label="Credit limit (KES)" hint="Orders billed by invoice stop once this much is unpaid.">
                  <Input type="number" min={0} value={creditValue} onChange={(e) => setCredit(e.target.value)} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={invoicingValue} onChange={(e) => setInvoicing(e.target.checked)} />
                  Pay by monthly invoice
                </label>
                {b.status === 'ACTIVE' && (
                  <Button variant="secondary" onClick={() => save.mutate()} loading={save.isPending}>
                    Save billing
                  </Button>
                )}
              </div>
            )}
          </Card>
          <Card title="Registration documents">
            {b.documents.length === 0 && (
              <p className="text-sm text-muted">The owner has not uploaded a business registration certificate.</p>
            )}
            <div className="space-y-3">
              {b.documents.map((d) => (
                <div key={d.id}>
                  <DocumentPreview id={d.id} mimeType={d.mimeType} alt="Business registration" />
                  <div className="mt-1 flex items-center gap-2">
                    <Badge status={d.status} />
                    {d.status === 'PENDING' && (
                      <>
                        <Button variant="secondary" onClick={() => reviewDoc.mutate({ docId: d.id, decision: 'APPROVED' })}>
                          Accept
                        </Button>
                        <Button variant="ghost" onClick={() => reviewDoc.mutate({ docId: d.id, decision: 'REJECTED' })}>
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Decision">
            <div className="space-y-3">
              {b.status !== 'ACTIVE' && (
                <Button onClick={() => approve.mutate()} loading={approve.isPending}>
                  {b.status === 'PENDING' ? 'Approve company' : 'Reactivate company'}
                </Button>
              )}
              {!isFinance && b.status !== 'ACTIVE' && (
                <p className="text-xs text-muted">Approved without credit; finance can enable invoicing later.</p>
              )}
              {(b.status === 'PENDING' || b.status === 'ACTIVE') && (
                <>
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (sent to the company)"
                  />
                  {b.status === 'PENDING' ? (
                    <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => reject.mutate()} loading={reject.isPending}>
                      Reject
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      disabled={reason.trim().length < 3}
                      onClick={() => suspend.mutate()}
                      loading={suspend.isPending}
                    >
                      Suspend
                    </Button>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
