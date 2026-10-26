'use client';

import type { GrowthConfig } from '@errandconnect/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

export default function RewardsSettingsPage() {
  const { data, error } = useQuery({
    queryKey: ['/admin/settings/growth'],
    queryFn: () => api.get<GrowthConfig>('/admin/settings/growth'),
  });
  return (
    <>
      <PageHeader title="Rewards & Plus" subtitle="Referral rewards, loyalty points, the Plus membership and featured shop prices" />
      <ErrorBox error={error} />
      {data ? <Editor initial={data} /> : <Loading />}
    </>
  );
}

function Editor({ initial }: { initial: GrowthConfig }) {
  const { can } = useAuth();
  const editable = can('FINANCE_MANAGER', 'MARKETING_MANAGER');
  const [config, setConfig] = useState(initial);
  const update = (fn: (c: GrowthConfig) => void) =>
    setConfig((c) => {
      const next = structuredClone(c);
      fn(next);
      return next;
    });
  const save = useAction(() => api.put('/admin/settings/growth', config), [['/admin/settings/growth']]);
  const numberInput = (value: number, set: (c: GrowthConfig, v: number) => void, step = 1) => (
    <Input
      type="number"
      step={step}
      disabled={!editable}
      value={Number.isNaN(value) ? '' : value}
      onChange={(e) => update((c) => set(c, num(e.target.value)))}
    />
  );
  const toggle = (label: string, checked: boolean, set: (c: GrowthConfig, v: boolean) => void) => (
    <label className="mb-3 flex items-center gap-2 text-sm">
      <input type="checkbox" disabled={!editable} checked={checked} onChange={(e) => update((c) => set(c, e.target.checked))} />
      {label}
    </label>
  );
  const cashback = config.loyalty.pointsPer100 * config.loyalty.valuePer100Points;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Referrals">
        {toggle('Referral rewards on', config.referral.enabled, (c, v) => (c.referral.enabled = v))}
        <p className="mb-3 text-sm text-muted">
          Paid into wallets after the invited person completes their first errand (as a customer or a runner).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Person who invited (KES)">
            {numberInput(config.referral.referrerReward, (c, v) => (c.referral.referrerReward = v))}
          </Field>
          <Field label="New user (KES)">{numberInput(config.referral.refereeReward, (c, v) => (c.referral.refereeReward = v))}</Field>
        </div>
      </Card>
      <Card title="Loyalty points">
        {toggle('Loyalty points on', config.loyalty.enabled, (c, v) => (c.loyalty.enabled = v))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Points per KES 100 spent">{numberInput(config.loyalty.pointsPer100, (c, v) => (c.loyalty.pointsPer100 = v))}</Field>
          <Field label="KES per 100 points">
            {numberInput(config.loyalty.valuePer100Points, (c, v) => (c.loyalty.valuePer100Points = v))}
          </Field>
          <Field label="Fewest points to redeem">
            {numberInput(config.loyalty.minRedeemPoints, (c, v) => (c.loyalty.minRedeemPoints = v))}
          </Field>
          <Field label="Plus members earn (×)">
            {numberInput(config.loyalty.plusMultiplier, (c, v) => (c.loyalty.plusMultiplier = v))}
          </Field>
        </div>
        {!Number.isNaN(cashback) && (
          <p className="mt-2 text-xs text-muted">Customers get back about {cashback / 100}% of what they spend.</p>
        )}
      </Card>
      <Card title="ErrandCONNECT Plus">
        {toggle('Plus open for new members', config.plus.enabled, (c, v) => (c.plus.enabled = v))}
        <Field label="Price for 30 days (KES)">{numberInput(config.plus.monthlyPrice, (c, v) => (c.plus.monthlyPrice = v))}</Field>
        <p className="mt-2 text-xs text-muted">
          Members pay no service fee and earn extra loyalty points. Price changes apply from the next renewal.
        </p>
      </Card>
      <Card title="Featured shops">
        <Field label="Price per week (KES)">{numberInput(config.featured.weeklyPrice, (c, v) => (c.featured.weeklyPrice = v))}</Field>
        <p className="mt-2 text-xs text-muted">
          Shops buy this in the app; their placement starts when the invoice ({kes(config.featured.weeklyPrice)} a week) is paid.
        </p>
      </Card>
      <div className="lg:col-span-2">
        {editable ? (
          <Card>
            <ErrorBox error={save.error} />
            {save.isSuccess && <Notice>Saved.</Notice>}
            <div className="mt-2 flex gap-2">
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => setConfig(initial)}>
                Undo changes
              </Button>
            </div>
          </Card>
        ) : (
          <Notice>Only finance and marketing managers can change these.</Notice>
        )}
      </div>
    </div>
  );
}
