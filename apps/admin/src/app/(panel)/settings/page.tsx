'use client';

import { calculateQuote, DELIVERY_TYPES, URGENCY_LEVELS, type PricingConfig } from '@errandconnect/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Input, Loading, Notice, PageHeader, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { humanize, kes } from '@/lib/format';
import { useAction } from '@/lib/hooks';

interface Category {
  slug: string;
  name: string;
  baseFee: number;
  isActive: boolean;
  sortOrder: number;
  _count: { orders: number };
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const pct = (rate: number) => String(Math.round(rate * 1000) / 10);

export default function SettingsPage() {
  const pricing = useQuery({ queryKey: ['/admin/settings/pricing'], queryFn: () => api.get<PricingConfig>('/admin/settings/pricing') });
  return (
    <>
      <PageHeader
        title="Pricing & categories"
        subtitle="Changes apply to new errands immediately; existing orders keep the price they were quoted"
      />
      <ErrorBox error={pricing.error} />
      {pricing.data ? <PricingEditor initial={pricing.data} /> : <Loading />}
      <div className="mt-6">
        <Categories />
      </div>
    </>
  );
}

function PricingEditor({ initial }: { initial: PricingConfig }) {
  const { can } = useAuth();
  const editable = can('FINANCE_MANAGER');
  const [config, setConfig] = useState<PricingConfig>(initial);
  const save = useAction(() => api.put<PricingConfig>('/admin/settings/pricing', config), [['/admin/settings/pricing']]);
  const update = (fn: (c: PricingConfig) => void) =>
    setConfig((c) => {
      const next = structuredClone(c);
      fn(next);
      return next;
    });

  // Live example so admins see what a change means for customers and runners.
  let example: ReturnType<typeof calculateQuote> | null = null;
  try {
    example = calculateQuote({ errandFee: 150, itemsCost: 1000, distanceKm: 5, deliveryType: 'MOTORCYCLE', urgency: 'STANDARD' }, config);
  } catch {
    example = null;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <Card title="Commission">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Platform commission on errand fee (%)
              <Input
                type="number"
                step="0.5"
                disabled={!editable}
                value={pct(config.commissionRate)}
                onChange={(e) => update((c) => (c.commissionRate = num(e.target.value) / 100))}
              />
            </label>
            <label className="text-sm">
              Runner&apos;s share of delivery fee (%)
              <Input
                type="number"
                step="1"
                disabled={!editable}
                value={pct(config.deliveryRunnerShare)}
                onChange={(e) => update((c) => (c.deliveryRunnerShare = num(e.target.value) / 100))}
              />
            </label>
          </div>
        </Card>
        <Card title="Delivery fees by vehicle">
          <Table
            rows={[...DELIVERY_TYPES]}
            columns={[
              { header: 'Vehicle', cell: (t) => humanize(t) },
              {
                header: 'Base fee (KES)',
                cell: (t) => (
                  <Input
                    type="number"
                    disabled={!editable}
                    value={config.delivery[t].baseFee}
                    onChange={(e) => update((c) => (c.delivery[t].baseFee = num(e.target.value)))}
                  />
                ),
              },
              {
                header: 'Included km',
                cell: (t) => (
                  <Input
                    type="number"
                    step="0.5"
                    disabled={!editable}
                    value={config.delivery[t].includedKm}
                    onChange={(e) => update((c) => (c.delivery[t].includedKm = num(e.target.value)))}
                  />
                ),
              },
              {
                header: 'Per extra km (KES)',
                cell: (t) => (
                  <Input
                    type="number"
                    disabled={!editable}
                    value={config.delivery[t].perKm}
                    onChange={(e) => update((c) => (c.delivery[t].perKm = num(e.target.value)))}
                  />
                ),
              },
            ]}
          />
        </Card>
        <Card title="Service fee by order value">
          <Table
            rows={config.serviceFeeTiers.map((t, i) => ({ ...t, i }))}
            columns={[
              {
                header: 'Order value below (KES)',
                cell: (t) =>
                  t.below === null ? (
                    'Any higher amount'
                  ) : (
                    <Input
                      type="number"
                      disabled={!editable}
                      value={t.below}
                      onChange={(e) => update((c) => (c.serviceFeeTiers[t.i].below = num(e.target.value)))}
                    />
                  ),
              },
              {
                header: 'Service fee (KES)',
                cell: (t) => (
                  <Input
                    type="number"
                    disabled={!editable}
                    value={t.fee}
                    onChange={(e) => update((c) => (c.serviceFeeTiers[t.i].fee = num(e.target.value)))}
                  />
                ),
              },
            ]}
          />
        </Card>
        <Card title="Urgent delivery">
          <Table
            rows={[...URGENCY_LEVELS]}
            columns={[
              { header: 'Speed', cell: (u) => humanize(u) },
              {
                header: 'Fee (KES)',
                cell: (u) => (
                  <Input
                    type="number"
                    disabled={!editable || u === 'STANDARD'}
                    value={config.urgency[u].fee}
                    onChange={(e) => update((c) => (c.urgency[u].fee = num(e.target.value)))}
                  />
                ),
              },
              {
                header: 'Runner share (%)',
                cell: (u) => (
                  <Input
                    type="number"
                    disabled={!editable || u === 'STANDARD'}
                    value={pct(config.urgency[u].runnerShare)}
                    onChange={(e) => update((c) => (c.urgency[u].runnerShare = num(e.target.value) / 100))}
                  />
                ),
              },
            ]}
          />
        </Card>
        <Card title="Surge pricing">
          <p className="mb-3 text-sm text-muted">
            When there are more open errands than online runners nearby, the delivery fee goes up (most of the extra goes to the runner, to
            bring more runners online). Use the minimum for events like heavy rain.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                disabled={!editable}
                checked={config.surge.enabled}
                onChange={(e) => update((c) => (c.surge.enabled = e.target.checked))}
              />
              Surge pricing on
            </label>
            <label className="text-sm">
              Highest multiplier (×)
              <Input
                type="number"
                step="0.1"
                disabled={!editable}
                value={config.surge.maxMultiplier}
                onChange={(e) => update((c) => (c.surge.maxMultiplier = num(e.target.value)))}
              />
            </label>
            <label className="text-sm">
              Minimum multiplier right now (×, 1 = none)
              <Input
                type="number"
                step="0.1"
                disabled={!editable}
                value={config.surge.manualMultiplier}
                onChange={(e) => update((c) => (c.surge.manualMultiplier = num(e.target.value)))}
              />
            </label>
            <label className="text-sm">
              Runner share of surge fee (%)
              <Input
                type="number"
                disabled={!editable}
                value={pct(config.surge.runnerShare)}
                onChange={(e) => update((c) => (c.surge.runnerShare = num(e.target.value) / 100))}
              />
            </label>
            <label className="text-sm">
              Area counted (km around the pickup)
              <Input
                type="number"
                step="0.5"
                disabled={!editable}
                value={config.surge.radiusKm}
                onChange={(e) => update((c) => (c.surge.radiusKm = num(e.target.value)))}
              />
            </label>
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="Example">
          <p className="mb-2 text-sm text-muted">KES 150 errand, KES 1,000 of items, 5 km by motorcycle:</p>
          {example ? (
            <ul className="space-y-1 text-sm">
              <li>
                Customer pays <b>{kes(example.customer.total)}</b>
              </li>
              <li>
                Runner gets {kes(example.runner.total - example.runner.itemsReimbursement)} (+ {kes(example.runner.itemsReimbursement)}{' '}
                items back)
              </li>
              <li>
                Platform keeps <b>{kes(example.platform.total)}</b>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-danger">Some values are invalid.</p>
          )}
        </Card>
        {editable ? (
          <Card>
            <ErrorBox error={save.error} />
            {save.isSuccess && <Notice>Pricing saved.</Notice>}
            <div className="mt-2 flex gap-2">
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                Save pricing
              </Button>
              <Button variant="secondary" onClick={() => setConfig(initial)}>
                Undo changes
              </Button>
            </div>
          </Card>
        ) : (
          <Notice>Only finance managers can change pricing.</Notice>
        )}
      </div>
    </div>
  );
}

function Categories() {
  const { can } = useAuth();
  const { data, error } = useQuery({ queryKey: ['/admin/categories'], queryFn: () => api.get<Category[]>('/admin/categories') });
  const update = useAction(
    (b: { slug: string; patch: Partial<Category> }) => api.patch(`/admin/categories/${b.slug}`, b.patch),
    [['/admin/categories']],
  );
  const [newCat, setNewCat] = useState({ slug: '', name: '', baseFee: '150' });
  const create = useAction(async () => {
    await api.post('/admin/categories', { slug: newCat.slug, name: newCat.name, baseFee: Number(newCat.baseFee) });
    setNewCat({ slug: '', name: '', baseFee: '150' });
  }, [['/admin/categories']]);

  return (
    <Card
      title="Errand categories"
      actions={<span className="text-xs text-muted">The base fee is the runner&apos;s errand fee for that type of errand</span>}
    >
      <ErrorBox error={error ?? update.error ?? create.error} />
      <Table
        rows={data}
        columns={[
          {
            header: 'Category',
            cell: (c) => (
              <div>
                {c.name}
                <div className="text-xs text-muted">{c.slug}</div>
              </div>
            ),
          },
          {
            header: 'Base fee (KES)',
            cell: (c) => (
              <Input
                type="number"
                defaultValue={c.baseFee}
                className="max-w-28"
                onBlur={(e) =>
                  Number(e.target.value) !== c.baseFee && update.mutate({ slug: c.slug, patch: { baseFee: Number(e.target.value) } })
                }
              />
            ),
          },
          { header: 'Orders', cell: (c) => c._count.orders },
          { header: 'Status', cell: (c) => <Badge status={c.isActive ? 'ACTIVE' : 'DISABLED'} /> },
          {
            header: '',
            cell: (c) => (
              <Button variant="secondary" onClick={() => update.mutate({ slug: c.slug, patch: { isActive: !c.isActive } })}>
                {c.isActive ? 'Hide from app' : 'Show in app'}
              </Button>
            ),
          },
        ]}
      />
      {can('OPERATIONS_MANAGER') && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Input
            className="max-w-48"
            placeholder="slug, e.g. pet-care"
            value={newCat.slug}
            onChange={(e) => setNewCat({ ...newCat, slug: e.target.value })}
          />
          <Input
            className="max-w-56"
            placeholder="Name, e.g. Pet Care"
            value={newCat.name}
            onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
          />
          <Input
            className="max-w-28"
            type="number"
            value={newCat.baseFee}
            onChange={(e) => setNewCat({ ...newCat, baseFee: e.target.value })}
          />
          <Button disabled={!newCat.slug || newCat.name.length < 2} onClick={() => create.mutate()} loading={create.isPending}>
            Add category
          </Button>
        </div>
      )}
    </Card>
  );
}
