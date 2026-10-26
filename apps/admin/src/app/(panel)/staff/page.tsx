'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth, type StaffRole } from '@/lib/auth';
import { dateTime, fullName, humanize } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface StaffRow {
  role: StaffRole;
  createdAt: string;
  twoFactorEnabledAt: string | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    status: string;
    lastLoginAt: string | null;
  };
}

const ROLES: StaffRole[] = [
  'SUPER_ADMIN',
  'OPERATIONS_MANAGER',
  'FINANCE_MANAGER',
  'CUSTOMER_SUPPORT',
  'RUNNER_MANAGER',
  'MARKETING_MANAGER',
  'CONTENT_MANAGER',
  'MERCHANT_MANAGER',
];

export default function StaffPage() {
  const { me } = useAuth();
  const key = ['/admin/staff'];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.get<StaffRow[]>('/admin/staff') });
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('CUSTOMER_SUPPORT');
  const add = useAction(async () => {
    await api.post('/admin/staff', { phone, role });
    setPhone('');
  }, [key]);
  const change = useAction((b: { userId: string; role: StaffRole }) => api.patch(`/admin/staff/${b.userId}`, { role: b.role }), [key]);
  const remove = useAction((userId: string) => api.delete(`/admin/staff/${userId}`), [key]);
  const resetMfa = useAction((userId: string) => api.delete(`/admin/staff/${userId}/mfa`), [key]);

  return (
    <>
      <PageHeader title="Staff" subtitle="Each role only sees the parts of the admin panel it needs" />
      <ErrorBox error={error ?? add.error ?? change.error ?? remove.error ?? resetMfa.error} />
      <Table
        rows={data}
        columns={[
          {
            header: 'Name',
            cell: (s) => (
              <div>
                {fullName(s.user)}
                <div className="text-xs text-muted">{s.user.phone}</div>
              </div>
            ),
          },
          {
            header: 'Role',
            cell: (s) =>
              s.user.id === me?.id ? (
                humanize(s.role)
              ) : (
                <Select
                  value={s.role}
                  onChange={(e) => change.mutate({ userId: s.user.id, role: e.target.value as StaffRole })}
                  options={ROLES}
                  aria-label="Role"
                />
              ),
          },
          { header: 'Account', cell: (s) => <Badge status={s.user.status} /> },
          { header: 'Two-factor', cell: (s) => (s.twoFactorEnabledAt ? 'On' : <span className="text-warning">Not set up</span>) },
          { header: 'Last login', cell: (s) => dateTime(s.user.lastLoginAt) },
          {
            header: '',
            cell: (s) =>
              s.user.id !== me?.id && (
                <div className="flex gap-1">
                  {s.twoFactorEnabledAt && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        window.confirm(`Reset two-factor sign-in for ${fullName(s.user)}? They will be signed out and set it up again.`) &&
                        resetMfa.mutate(s.user.id)
                      }
                    >
                      Reset 2FA
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => window.confirm(`Remove ${fullName(s.user)} from staff?`) && remove.mutate(s.user.id)}
                  >
                    Remove
                  </Button>
                </div>
              ),
          },
        ]}
      />
      <div className="mt-6">
        <Card title="Add a staff member">
          <p className="mb-3 text-sm text-muted">They must first create an account in the ErrandCONNECT app with their phone number.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} options={ROLES} />
            </Field>
            <Button disabled={phone.length < 9} onClick={() => add.mutate()} loading={add.isPending}>
              Add
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
