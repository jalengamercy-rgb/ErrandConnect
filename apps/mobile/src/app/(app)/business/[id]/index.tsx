import { normalizeKenyanPhone } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ORG_STATUS_LABELS, useBusiness, type Business } from '@/lib/business';
import { getCurrentLocation } from '@/lib/device';
import { formatAddress, humanize } from '@/lib/format';
import { formatKes } from '@/lib/orders';

/** Runs a company change and refreshes the company. */
function useBusinessAction<T>(id: string, request: (body: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });
}

export default function BusinessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const { data: b, isLoading, error } = useBusiness(id);
  const leave = useBusinessAction(id, () => api.delete(`/businesses/${id}/members/${me?.id}`));

  if (isLoading) return <Loading />;
  if (!b) return <Notice tone="error">{error?.message ?? 'Company not found'}</Notice>;
  const manage = b.myRole !== 'MEMBER';

  return (
    <Screen>
      <Card>
        <ThemedText type="subtitle">{b.name}</ThemedText>
        <ThemedText type="small">{ORG_STATUS_LABELS[b.status]}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          You are {humanize(b.myRole).toLowerCase()}
          {b.myRole === 'MEMBER' && b.myApprovalLimit != null ? ` · errands above ${formatKes(b.myApprovalLimit)} need approval` : ''}
        </ThemedText>
      </Card>
      {b.status === 'PENDING' && (
        <Notice>
          We&apos;re checking your company details. You&apos;ll get a notification once it&apos;s approved, usually within 1 working day.
        </Notice>
      )}
      {b.status === 'ACTIVE' && (
        <>
          <Card>
            <ThemedText type="smallBold">{b.monthlyInvoicing ? 'Monthly invoicing' : 'Prepaid'}</ThemedText>
            {b.monthlyInvoicing ? (
              <ThemedText type="small">
                Credit used {formatKes(b.creditUsed)} of {formatKes(b.creditLimit)} · {formatKes(b.creditAvailable)} available
              </ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Team members pay for company errands by M-Pesa or wallet. Ask us to enable monthly invoicing.
              </ThemedText>
            )}
          </Card>
          <Button title="New company errand" onPress={() => router.push({ pathname: '/orders/new', params: { business: b.id } })} />
          {manage && (
            <Button
              title={b.pendingApprovals ? `Approvals (${b.pendingApprovals} waiting)` : 'Approvals'}
              variant={b.pendingApprovals ? 'primary' : 'secondary'}
              onPress={() => router.push({ pathname: '/business/[id]/orders', params: { id: b.id, view: 'PENDING_APPROVAL' } })}
            />
          )}
          <Button
            title={manage ? 'Company errands' : 'My company errands'}
            variant="secondary"
            onPress={() => router.push({ pathname: '/business/[id]/orders', params: { id: b.id, view: 'ACTIVE' } })}
          />
          {manage && b.monthlyInvoicing && <Button title="Invoices" variant="secondary" onPress={() => router.push('/invoices')} />}
        </>
      )}

      <Team business={b} />
      <Branches business={b} />

      {b.myRole !== 'OWNER' && (
        <>
          {leave.error && <Notice tone="error">{leave.error.message}</Notice>}
          <Button
            title="Leave this company"
            variant="ghost"
            loading={leave.isPending}
            onPress={() => leave.mutate(undefined, { onSuccess: () => router.replace('/business') })}
          />
        </>
      )}
    </Screen>
  );
}

function Team({ business: b }: { business: Business }) {
  const manage = b.myRole !== 'MEMBER';
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER');
  const [limit, setLimit] = useState('');
  const add = useBusinessAction(b.id, () =>
    api.post(`/businesses/${b.id}/members`, { phone, role, approvalLimit: limit ? Number.parseInt(limit, 10) : null }),
  );
  const remove = useBusinessAction(b.id, (userId: string) => api.delete(`/businesses/${b.id}/members/${userId}`));

  return (
    <Card>
      <ThemedText type="smallBold">Team ({b.members.length})</ThemedText>
      {b.members.map((m) => (
        <ThemedText key={m.userId} type="small">
          {m.user.firstName} {m.user.lastName} · {humanize(m.role)}
          {m.position ? ` · ${m.position}` : ''}
          {m.role === 'MEMBER' && m.approvalLimit != null ? ` · approval above ${formatKes(m.approvalLimit)}` : ''}
        </ThemedText>
      ))}
      {manage &&
        (adding ? (
          <>
            <TextField
              label="Their phone number"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              hint="They need an ErrandCONNECT account first."
            />
            {b.myRole === 'OWNER' && (
              <ChoiceChips
                choices={[
                  { value: 'MEMBER', label: 'Member' },
                  { value: 'ADMIN', label: 'Admin (can approve)' },
                ]}
                value={role}
                onChange={setRole}
              />
            )}
            {role === 'MEMBER' && (
              <TextField
                label="Needs approval above (KES)"
                optional
                keyboardType="number-pad"
                value={limit}
                onChangeText={(t) => setLimit(t.replace(/\D/g, ''))}
                hint="Leave empty to let them order without approval."
              />
            )}
            {add.error && <Notice tone="error">{add.error.message}</Notice>}
            <Button
              title="Add to team"
              disabled={!normalizeKenyanPhone(phone)}
              loading={add.isPending}
              onPress={() =>
                add.mutate(undefined, {
                  onSuccess: () => {
                    setAdding(false);
                    setPhone('');
                    setLimit('');
                  },
                })
              }
            />
          </>
        ) : (
          <Button title="Add a team member" variant="secondary" onPress={() => setAdding(true)} />
        ))}
      {manage &&
        b.members
          .filter((m) => m.role === 'MEMBER' || (b.myRole === 'OWNER' && m.role === 'ADMIN'))
          .map((m) => (
            <Button
              key={m.userId}
              title={`Remove ${m.user.firstName}`}
              variant="ghost"
              loading={remove.isPending && remove.variables === m.userId}
              onPress={() => remove.mutate(m.userId)}
            />
          ))}
      {remove.error && <Notice tone="error">{remove.error.message}</Notice>}
    </Card>
  );
}

function Branches({ business: b }: { business: Business }) {
  const manage = b.myRole !== 'MEMBER';
  const [label, setLabel] = useState('');
  const [building, setBuilding] = useState('');
  const add = useBusinessAction(b.id, async () => {
    const here = await getCurrentLocation();
    await api.post(`/businesses/${b.id}/branches`, { label: label.trim(), building: building.trim() || undefined, ...here });
    setLabel('');
    setBuilding('');
  });
  const remove = useBusinessAction(b.id, (addressId: string) => api.delete(`/businesses/${b.id}/branches/${addressId}`));

  return (
    <Card>
      <ThemedText type="smallBold">Branches and offices</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        The whole team can pick these as delivery points.
      </ThemedText>
      {b.branches.map((a) => (
        <ThemedText key={a.id} type="small">
          📍 {[a.label, formatAddress(a)].filter(Boolean).join(' · ')}
        </ThemedText>
      ))}
      {manage && (
        <>
          <TextField label="Branch name" placeholder="e.g. Westlands office" value={label} onChangeText={setLabel} />
          <TextField label="Building" optional value={building} onChangeText={setBuilding} />
          {add.error && <Notice tone="error">{add.error.message}</Notice>}
          <Button
            title="Add branch at my current location"
            variant="secondary"
            disabled={!label.trim()}
            loading={add.isPending}
            onPress={() => add.mutate(undefined)}
          />
          {b.branches.map((a) => (
            <Button key={a.id} title={`Remove ${a.label}`} variant="ghost" onPress={() => remove.mutate(a.id)} />
          ))}
        </>
      )}
    </Card>
  );
}
