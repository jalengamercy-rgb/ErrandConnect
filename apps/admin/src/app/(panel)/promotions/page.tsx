'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Pagination, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, humanize, kes } from '@/lib/format';
import { useAction, usePagedList } from '@/lib/hooks';

interface Promo {
  id: string;
  code: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  endsAt: string | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  firstOrderOnly: boolean;
  isActive: boolean;
  redemptions: number;
  discountGiven: number;
}

interface Banner {
  id: string;
  title: string;
  body: string | null;
  merchantId: string | null;
  categorySlug: string | null;
  url: string | null;
  audience: string;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  priority: number;
  advertiser: string | null;
  amountPaid: number;
  impressions: number;
  clicks: number;
}

/** yyyy-mm-dd from a date input to an ISO time at the end of that day. */
const endOfDay = (value: string) => (value ? new Date(`${value}T23:59:59`).toISOString() : undefined);

export default function PromotionsPage() {
  return (
    <>
      <PageHeader title="Promotions" subtitle="Promo codes customers enter at checkout, and banners and ads on the app home screen" />
      <PromoCodes />
      <div className="mt-8">
        <Banners />
      </div>
    </>
  );
}

function PromoCodes() {
  const { can } = useAuth();
  const canEdit = can('MARKETING_MANAGER');
  const { query, page, setPage, filters, setFilter, pageSize } = usePagedList<Promo, { state: string; search: string }>('/admin/promos', {
    state: 'active',
    search: '',
  });
  const blank = {
    code: '',
    description: '',
    type: 'PERCENT',
    value: '',
    maxDiscount: '',
    minOrderValue: '',
    endsAt: '',
    maxRedemptions: '',
    perUserLimit: '1',
    firstOrderOnly: false,
  };
  const [form, setForm] = useState(blank);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const n = (v: string) => (v.trim() ? Number(v) : undefined);
  const create = useAction(async () => {
    await api.post('/admin/promos', {
      code: form.code,
      description: form.description,
      type: form.type,
      value: n(form.value),
      maxDiscount: form.type === 'PERCENT' ? n(form.maxDiscount) : undefined,
      minOrderValue: n(form.minOrderValue),
      endsAt: endOfDay(form.endsAt),
      maxRedemptions: n(form.maxRedemptions),
      perUserLimit: n(form.perUserLimit),
      firstOrderOnly: form.firstOrderOnly,
    });
    setForm(blank);
  }, [['/admin/promos']]);
  const toggle = useAction((p: Promo) => api.patch(`/admin/promos/${p.id}`, { isActive: !p.isActive }), [['/admin/promos']]);

  return (
    <>
      <h2 className="mb-3 text-lg font-semibold">Promo codes</h2>
      <div className="mb-3 grid gap-2 sm:grid-cols-[180px_1fr]">
        <Select
          value={filters.state}
          onChange={(e) => setFilter('state', e.target.value)}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Switched off' },
            { value: '', label: 'All' },
          ]}
          aria-label="State"
        />
        <Input placeholder="Search code or description" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
      </div>
      <ErrorBox error={query.error ?? toggle.error} />
      <Table
        rows={query.data?.items}
        columns={[
          {
            header: 'Code',
            cell: (p) => (
              <div>
                <div className="font-mono font-medium">{p.code}</div>
                <div className="text-xs text-muted">{p.description}</div>
              </div>
            ),
          },
          {
            header: 'Discount',
            cell: (p) => (p.type === 'PERCENT' ? `${p.value}%${p.maxDiscount ? ` up to ${kes(p.maxDiscount)}` : ''}` : kes(p.value)),
          },
          {
            header: 'Rules',
            cell: (p) =>
              [
                p.minOrderValue ? `min ${kes(p.minOrderValue)}` : null,
                p.firstOrderOnly ? 'first errand only' : null,
                `${p.perUserLimit}× per customer`,
                p.endsAt ? `until ${date(p.endsAt)}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
          },
          { header: 'Used', cell: (p) => `${p.redemptions}${p.maxRedemptions ? ` / ${p.maxRedemptions}` : ''}` },
          { header: 'Discount given', cell: (p) => kes(p.discountGiven) },
          { header: 'State', cell: (p) => <Badge status={p.isActive ? 'ACTIVE' : 'CLOSED'} /> },
          {
            header: '',
            cell: (p) =>
              canEdit && (
                <Button variant="ghost" onClick={() => toggle.mutate(p)}>
                  {p.isActive ? 'Switch off' : 'Switch on'}
                </Button>
              ),
          },
        ]}
        empty="No promo codes."
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} onPage={setPage} />}

      {canEdit && (
        <div className="mt-4">
          <Card title="New promo code">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Code">
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
                  placeholder="WELCOME100"
                />
              </Field>
              <Field label="Description (customers see this)">
                <Input value={form.description} onChange={set('description')} placeholder="KES 100 off your first errand" />
              </Field>
              <Field label="Type">
                <Select
                  value={form.type}
                  onChange={set('type')}
                  options={[
                    { value: 'PERCENT', label: 'Percent off fees' },
                    { value: 'FIXED', label: 'Shillings off' },
                  ]}
                />
              </Field>
              <Field label={form.type === 'PERCENT' ? 'Percent' : 'Amount (KES)'}>
                <Input type="number" min={1} value={form.value} onChange={set('value')} />
              </Field>
              {form.type === 'PERCENT' && (
                <Field label="Most it can take off (KES)" hint="Optional">
                  <Input type="number" min={1} value={form.maxDiscount} onChange={set('maxDiscount')} />
                </Field>
              )}
              <Field label="Minimum order (KES)" hint="Optional">
                <Input type="number" min={0} value={form.minOrderValue} onChange={set('minOrderValue')} />
              </Field>
              <Field label="Last day" hint="Optional">
                <Input type="date" value={form.endsAt} onChange={set('endsAt')} />
              </Field>
              <Field label="Total uses" hint="Optional; empty = unlimited">
                <Input type="number" min={1} value={form.maxRedemptions} onChange={set('maxRedemptions')} />
              </Field>
              <Field label="Uses per customer">
                <Input type="number" min={1} value={form.perUserLimit} onChange={set('perUserLimit')} />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.firstOrderOnly}
                onChange={(e) => setForm((f) => ({ ...f, firstOrderOnly: e.target.checked }))}
              />
              Only for a customer&apos;s first errand
            </label>
            <p className="mt-2 text-xs text-muted">
              Discounts come off ErrandCONNECT&apos;s fees only. Runners are always paid in full, and items the runner buys are never
              discounted.
            </p>
            <div className="mt-3">
              <ErrorBox error={create.error} />
              <Button
                disabled={form.code.length < 3 || form.description.trim().length < 3 || !form.value}
                onClick={() => create.mutate()}
                loading={create.isPending}
              >
                Create code
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function Banners() {
  const { can } = useAuth();
  const canEdit = can('MARKETING_MANAGER');
  const canRecordPayment = can('FINANCE_MANAGER');
  const key = ['/admin/banners'];
  const { data, error } = useQuery({ queryKey: key, queryFn: () => api.get<Banner[]>('/admin/banners') });
  const categories = useQuery({ queryKey: ['/categories'], queryFn: () => api.get<{ slug: string; name: string }[]>('/categories') });
  const blank = {
    title: '',
    body: '',
    link: 'none',
    categorySlug: '',
    url: '',
    audience: 'CUSTOMERS',
    endsAt: '',
    priority: '0',
    advertiser: '',
  };
  const [form, setForm] = useState(blank);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [payment, setPayment] = useState<{ id: string; amount: string; reference: string } | null>(null);

  const create = useAction(async () => {
    await api.post('/admin/banners', {
      title: form.title,
      body: form.body || undefined,
      categorySlug: form.link === 'category' ? form.categorySlug : undefined,
      url: form.link === 'url' ? form.url : undefined,
      audience: form.audience,
      endsAt: endOfDay(form.endsAt),
      priority: Number(form.priority) || 0,
      advertiser: form.advertiser || undefined,
    });
    setForm(blank);
  }, [key]);
  const toggle = useAction((b: Banner) => api.patch(`/admin/banners/${b.id}`, { isActive: !b.isActive }), [key]);
  const pay = useAction(async () => {
    await api.post(`/admin/banners/${payment!.id}/payments`, { amount: Number(payment!.amount), reference: payment!.reference });
    setPayment(null);
  }, [key]);

  return (
    <>
      <h2 className="mb-3 text-lg font-semibold">Banners and ads</h2>
      <ErrorBox error={error ?? toggle.error ?? pay.error} />
      <Table
        rows={data}
        columns={[
          {
            header: 'Banner',
            cell: (b) => (
              <div>
                <div className="font-medium">{b.title}</div>
                <div className="text-xs text-muted">
                  {[
                    b.body,
                    b.categorySlug && `→ ${humanize(b.categorySlug.replace(/-/g, '_'))}`,
                    b.url && `→ ${b.url}`,
                    b.merchantId && '→ shop',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ),
          },
          { header: 'Shown to', cell: (b) => humanize(b.audience) },
          { header: 'Runs', cell: (b) => `${date(b.startsAt)} – ${b.endsAt ? date(b.endsAt) : 'no end'}` },
          {
            header: 'Views / taps',
            cell: (b) => `${b.impressions} / ${b.clicks}${b.impressions ? ` (${Math.round((b.clicks / b.impressions) * 100)}%)` : ''}`,
          },
          { header: 'Advertiser', cell: (b) => (b.advertiser ? `${b.advertiser} · paid ${kes(b.amountPaid)}` : '—') },
          { header: 'State', cell: (b) => <Badge status={b.isActive ? 'ACTIVE' : 'CLOSED'} /> },
          {
            header: '',
            cell: (b) => (
              <div className="flex gap-1">
                {canEdit && (
                  <Button variant="ghost" onClick={() => toggle.mutate(b)}>
                    {b.isActive ? 'Stop' : 'Start'}
                  </Button>
                )}
                {canRecordPayment && b.advertiser && (
                  <Button variant="ghost" onClick={() => setPayment({ id: b.id, amount: '', reference: '' })}>
                    Record payment
                  </Button>
                )}
              </div>
            ),
          },
        ]}
        empty="No banners yet."
      />
      {payment && (
        <div className="mt-3">
          <Card title="Record an ad payment">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Amount (KES)">
                <Input type="number" min={1} value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
              </Field>
              <Field label="Bank or M-Pesa reference">
                <Input value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} />
              </Field>
              <Button
                disabled={!Number(payment.amount) || payment.reference.trim().length < 3}
                onClick={() => pay.mutate()}
                loading={pay.isPending}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setPayment(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
      {canEdit && (
        <div className="mt-4">
          <Card title="New banner">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Title">
                <Input value={form.title} onChange={set('title')} maxLength={80} placeholder="Groceries delivered in 30 minutes" />
              </Field>
              <Field label="Text" hint="Optional">
                <Input value={form.body} onChange={set('body')} maxLength={200} />
              </Field>
              <Field label="Shown to">
                <Select
                  value={form.audience}
                  onChange={set('audience')}
                  options={[
                    { value: 'CUSTOMERS', label: 'Customers' },
                    { value: 'RUNNERS', label: 'Runners' },
                    { value: 'ALL', label: 'Everyone' },
                  ]}
                />
              </Field>
              <Field label="Tapping opens">
                <Select
                  value={form.link}
                  onChange={set('link')}
                  options={[
                    { value: 'none', label: 'Nothing' },
                    { value: 'category', label: 'An errand type' },
                    { value: 'url', label: 'A web page' },
                  ]}
                />
              </Field>
              {form.link === 'category' && (
                <Field label="Errand type">
                  <Select
                    value={form.categorySlug}
                    onChange={set('categorySlug')}
                    options={[{ value: '', label: 'Choose…' }, ...(categories.data ?? []).map((c) => ({ value: c.slug, label: c.name }))]}
                  />
                </Field>
              )}
              {form.link === 'url' && (
                <Field label="Web page (https://…)">
                  <Input value={form.url} onChange={set('url')} />
                </Field>
              )}
              <Field label="Last day" hint="Optional">
                <Input type="date" value={form.endsAt} onChange={set('endsAt')} />
              </Field>
              <Field label="Priority (0-100)" hint="Higher shows first">
                <Input type="number" min={0} max={100} value={form.priority} onChange={set('priority')} />
              </Field>
              <Field label="Advertiser" hint="Only for paid ads">
                <Input value={form.advertiser} onChange={set('advertiser')} />
              </Field>
            </div>
            <div className="mt-3">
              <ErrorBox error={create.error} />
              <Button
                disabled={
                  form.title.trim().length < 2 || (form.link === 'category' && !form.categorySlug) || (form.link === 'url' && !form.url)
                }
                onClick={() => create.mutate()}
                loading={create.isPending}
              >
                Create banner
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
