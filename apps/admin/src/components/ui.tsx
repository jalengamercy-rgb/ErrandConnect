'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { humanize } from '@/lib/format';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warning' | 'danger' }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean };

export function Button({ variant = 'primary', loading, disabled, className = '', children, ...rest }: ButtonProps) {
  const styles = {
    primary: 'bg-brand text-white hover:opacity-90',
    secondary: 'border border-border bg-surface hover:bg-brand-soft',
    danger: 'bg-danger text-white hover:opacity-90',
    ghost: 'text-brand hover:underline',
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...rest}
    >
      {loading ? 'Working…' : children}
    </button>
  );
}

const fieldClass = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`${fieldClass} ${props.className ?? ''}`} />
);
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...props} className={`${fieldClass} ${props.className ?? ''}`} />
);

export function Select({
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { options: readonly (string | { value: string; label: string })[] }) {
  return (
    <select {...props} className={`${fieldClass} ${props.className ?? ''}`}>
      {options.map((o) => {
        const { value, label } = typeof o === 'string' ? { value: o, label: o ? humanize(o) : 'All' } : o;
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="whitespace-pre-line rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm">{children}</div>;
}

export const Loading = () => <div className="p-6 text-sm text-muted">Loading…</div>;

const STATUS_COLORS: Record<string, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
};
const STATUS_TONE: Record<string, keyof typeof STATUS_COLORS> = {
  APPROVED: 'green',
  ACTIVE: 'green',
  COMPLETED: 'green',
  PAID: 'green',
  SUCCEEDED: 'green',
  RELEASED: 'green',
  RESOLVED: 'green',
  HELD: 'blue',
  PENDING: 'amber',
  SUBMITTED: 'amber',
  UNDER_REVIEW: 'amber',
  REQUESTED: 'amber',
  OPEN: 'amber',
  AWAITING_PAYMENT: 'amber',
  PENDING_APPROVAL: 'amber',
  ISSUED: 'amber',
  ON_HOLD: 'amber',
  ACCEPTED: 'blue',
  RUNNER_ASSIGNED: 'blue',
  AT_STORE: 'blue',
  PICKED_UP: 'blue',
  IN_TRANSIT: 'blue',
  REJECTED: 'red',
  SUSPENDED: 'red',
  BLOCKED: 'red',
  CANCELLED: 'red',
  FAILED: 'red',
  DISPUTED: 'red',
  REFUNDED: 'gray',
  CLOSED: 'gray',
  DRAFT: 'gray',
  VOID: 'gray',
};

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[STATUS_TONE[status] ?? 'gray']}`}>
      {humanize(status)}
    </span>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({
  rows,
  columns,
  onRowClick,
  empty = 'Nothing here.',
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs uppercase text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={`px-3 py-2 font-medium ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows?.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
          {rows?.map((row, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-border last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-brand-soft' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.header} className={`px-3 py-2 align-top ${c.className ?? ''}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows && <Loading />}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted">
      <span>
        {total} total · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** Simple bar chart for daily figures. */
export function BarChart({ data, format = String }: { data: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Bar chart">
      {data.map((d) => (
        <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end">
          <div className="rounded-t bg-brand" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }} />
          <div className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-xs text-background group-hover:block">
            {d.label}: {format(d.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}
