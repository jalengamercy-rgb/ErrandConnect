'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth, type StaffRole } from '@/lib/auth';
import { humanize } from '@/lib/format';
import { TwoFactorScreen } from './two-factor';
import { Loading } from './ui';

/** Sidebar entries and which roles see them (super admins see everything). */
const NAV: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: '/', label: 'Dashboard', roles: [] },
  { href: '/runners', label: 'Runners', roles: ['OPERATIONS_MANAGER', 'RUNNER_MANAGER'] },
  { href: '/customers', label: 'Customers', roles: ['OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT'] },
  { href: '/orders', label: 'Orders', roles: ['OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT'] },
  { href: '/map', label: 'Live map', roles: ['OPERATIONS_MANAGER', 'RUNNER_MANAGER', 'CUSTOMER_SUPPORT'] },
  {
    href: '/insights',
    label: 'Insights',
    roles: ['OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'CUSTOMER_SUPPORT', 'RUNNER_MANAGER', 'MARKETING_MANAGER'],
  },
  { href: '/disputes', label: 'Disputes', roles: ['OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT'] },
  { href: '/tickets', label: 'Support tickets', roles: ['OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT'] },
  { href: '/businesses', label: 'Companies', roles: ['OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'MERCHANT_MANAGER'] },
  { href: '/merchants', label: 'Shops', roles: ['OPERATIONS_MANAGER', 'MERCHANT_MANAGER'] },
  { href: '/finance', label: 'Finance', roles: ['FINANCE_MANAGER'] },
  { href: '/invoices', label: 'Invoices', roles: ['FINANCE_MANAGER'] },
  { href: '/reviews', label: 'Reviews', roles: ['OPERATIONS_MANAGER', 'CUSTOMER_SUPPORT', 'RUNNER_MANAGER'] },
  { href: '/reports', label: 'Reports', roles: ['OPERATIONS_MANAGER', 'FINANCE_MANAGER', 'MARKETING_MANAGER'] },
  { href: '/announcements', label: 'Announcements', roles: ['OPERATIONS_MANAGER', 'MARKETING_MANAGER'] },
  { href: '/promotions', label: 'Promotions', roles: ['MARKETING_MANAGER', 'FINANCE_MANAGER'] },
  { href: '/rewards', label: 'Rewards & Plus', roles: ['MARKETING_MANAGER', 'FINANCE_MANAGER', 'OPERATIONS_MANAGER'] },
  { href: '/settings', label: 'Pricing & categories', roles: ['FINANCE_MANAGER', 'OPERATIONS_MANAGER'] },
  { href: '/staff', label: 'Staff', roles: ['SUPER_ADMIN'] },
  { href: '/audit-logs', label: 'Activity log', roles: ['SUPER_ADMIN'] },
];

/** Page frame for signed-in staff; sends everyone else to /login. */
export function Shell({ children }: { children: ReactNode }) {
  const { status, me, logout, can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
  }, [status, router]);

  if (status === 'mfa') return <TwoFactorScreen />;
  if (status !== 'signedIn' || !me) return <Loading />;
  const items = NAV.filter((item) => can(...item.roles));
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-border bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="px-4 py-4 text-lg font-bold">
          Errand<span className="text-brand">CONNECT</span>
          <div className="text-xs font-normal text-muted">Admin</div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive(item.href) ? 'bg-brand-soft font-medium text-brand' : 'hover:bg-brand-soft'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-border px-4 py-3 text-xs text-muted md:block">
          <div className="font-medium text-foreground">
            {me.firstName} {me.lastName}
          </div>
          <div>{humanize(me.staffProfile?.role)}</div>
          <button className="mt-2 text-brand hover:underline" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
