'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, session } from './api';

export type StaffRole =
  | 'SUPER_ADMIN'
  | 'OPERATIONS_MANAGER'
  | 'FINANCE_MANAGER'
  | 'CUSTOMER_SUPPORT'
  | 'MERCHANT_MANAGER'
  | 'RUNNER_MANAGER'
  | 'MARKETING_MANAGER'
  | 'CONTENT_MANAGER';

export interface Me {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  staffProfile: { role: StaffRole } | null;
}

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  me: Me | undefined;
  login(phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** True if the logged-in staff member has one of these roles (super admins always do). */
  can(...roles: StaffRole[]): boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    session.onExpired(() => {
      queryClient.clear();
      setStatus('signedOut');
    });
    session.refresh().then((ok) => setStatus(ok ? 'signedIn' : 'signedOut'));
  }, [queryClient]);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me'), enabled: status === 'signedIn' });

  const login = useCallback(
    async (phone: string, password: string) => {
      const result = await api.post<{ user: Me; tokens: { accessToken: string; refreshToken: string } }>('/auth/login', {
        phone,
        password,
        deviceName: 'Admin panel',
      });
      if (!result.user.staffProfile) {
        session.start(result.tokens);
        await api.post('/auth/logout').catch(() => undefined);
        session.end();
        throw new ApiError(403, 'This account is not a staff account');
      }
      session.start(result.tokens);
      queryClient.setQueryData(['me'], result.user);
      setStatus('signedIn');
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    session.end();
    queryClient.clear();
    setStatus('signedOut');
  }, [queryClient]);

  const me = meQuery.data;
  const can = useCallback(
    (...roles: StaffRole[]) => {
      const role = me?.staffProfile?.role;
      return role === 'SUPER_ADMIN' || (!!role && (roles.length === 0 || roles.includes(role)));
    },
    [me],
  );

  // A session restored from storage must belong to staff.
  const effective: Status = status === 'signedIn' && (!me || !me.staffProfile) ? (meQuery.isError || me ? 'signedOut' : 'loading') : status;
  const value = useMemo(() => ({ status: effective, me, login, logout, can }), [effective, me, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be inside AuthProvider');
  return value;
}
