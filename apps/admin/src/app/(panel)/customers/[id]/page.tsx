'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { DocumentPreview } from '@/components/document-preview';
import { Badge, Button, Card, ErrorBox, KeyValue, Loading, PageHeader, Table, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, dateTime, fullName, humanize, kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
  idVerifiedAt: string | null;
  referralCode: string;
  customerProfile: { customerCode: string; verificationLevel: number };
  wallets: { type: string; balance: number }[];
  documents: { id: string; type: string; mimeType: string; status: string }[];
  addresses: { id: string; label: string; area: string | null; city: string | null }[];
  ordersAsCustomer: { id: string; orderNumber: string; status: string; total: number; createdAt: string }[];
  _count: { ordersAsCustomer: number };
  lifetimeSpend: number;
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const key = ['/admin/customers', id];
  const { data: c, error } = useQuery({ queryKey: key, queryFn: () => api.get<Customer>(`/admin/customers/${id}`) });
  const [reason, setReason] = useState('');
  const refresh = [key, ['/admin/customers']];
  const reviewDoc = useAction(
    (b: { docId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }) =>
      api.post(`/admin/documents/${b.docId}/review`, { decision: b.decision, reason: b.reason }),
    refresh,
  );
  const verify = useAction(() => api.post(`/admin/customers/${id}/verify-id`), refresh);
  const suspend = useAction(() => api.post(`/admin/users/${id}/suspend`, { reason }), refresh);
  const activate = useAction(() => api.post(`/admin/users/${id}/activate`), refresh);

  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loading />;
  const idDocs = c.documents.filter((d) =>
    ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'PASSPORT', 'DRIVING_LICENCE', 'SELFIE'].includes(d.type),
  );

  return (
    <>
      <PageHeader title={fullName(c)} subtitle={`${c.customerProfile.customerCode} · ${c.phone}`} actions={<Badge status={c.status} />} />
      <ErrorBox error={reviewDoc.error ?? verify.error ?? suspend.error ?? activate.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Orders (${c._count.ordersAsCustomer}) · lifetime spend ${kes(c.lifetimeSpend)}`}>
            <Table
              rows={c.ordersAsCustomer}
              columns={[
                {
                  header: 'Order',
                  cell: (o) => (
                    <Link className="text-brand hover:underline" href={`/orders/${o.id}`}>
                      {o.orderNumber}
                    </Link>
                  ),
                },
                { header: 'Status', cell: (o) => <Badge status={o.status} /> },
                { header: 'Total', cell: (o) => kes(o.total) },
                { header: 'Date', cell: (o) => dateTime(o.createdAt) },
              ]}
              empty="No orders yet."
            />
          </Card>
          <Card
            title="ID verification"
            actions={
              c.customerProfile.verificationLevel < 3 && (
                <Button onClick={() => verify.mutate()} loading={verify.isPending}>
                  Mark ID verified
                </Button>
              )
            }
          >
            {idDocs.length === 0 && <p className="text-sm text-muted">No ID documents uploaded.</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              {idDocs.map((d) => (
                <div key={d.id} className="space-y-2 rounded-lg border border-border p-2 text-sm">
                  <div className="flex justify-between">
                    {humanize(d.type)} <Badge status={d.status} />
                  </div>
                  <DocumentPreview id={d.id} mimeType={d.mimeType} alt={humanize(d.type)} />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={d.status === 'APPROVED'}
                      onClick={() => reviewDoc.mutate({ docId: d.id, decision: 'APPROVED' })}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const why = window.prompt('Why is this document rejected?');
                        if (why && why.trim().length >= 3) reviewDoc.mutate({ docId: d.id, decision: 'REJECTED', reason: why.trim() });
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Account">
            <KeyValue
              items={[
                ['Email', c.email ? `${c.email} ${c.emailVerifiedAt ? '✓' : '(unverified)'}` : '—'],
                [
                  'Level',
                  c.customerProfile.verificationLevel === 3 ? '🟢 Verified customer' : `Level ${c.customerProfile.verificationLevel}`,
                ],
                ['Wallet', kes(c.wallets.find((w) => w.type === 'CUSTOMER')?.balance)],
                ['Referral code', c.referralCode],
                ['Joined', date(c.createdAt)],
                ['Last login', dateTime(c.lastLoginAt)],
                ['Addresses', c.addresses.map((a) => `${a.label} (${a.area ?? a.city ?? '—'})`).join(', ')],
              ]}
            />
          </Card>
          {can('OPERATIONS_MANAGER') && (
            <Card title="Account status">
              {c.status === 'ACTIVE' ? (
                <div className="space-y-2">
                  <Textarea placeholder="Reason for suspending" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => suspend.mutate()} loading={suspend.isPending}>
                    Suspend account
                  </Button>
                </div>
              ) : (
                <Button onClick={() => activate.mutate()} loading={activate.isPending}>
                  Reactivate account
                </Button>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
