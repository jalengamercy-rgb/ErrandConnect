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

type Status = 'loading' | 'signedOut' | 'signedIn' | 'mfa';

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  sessionVerified: boolean;
  recoveryCodesLeft: number;
}

interface AuthValue {
  /** 'mfa' = signed in, but must set up or enter two-factor sign-in before using the panel. */
  status: Status;
  me: Me | undefined;
  mfa: MfaStatus | undefined;
  refreshMfa(): Promise<unknown>;
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
    session.onMfaNeeded(() => void queryClient.invalidateQueries({ queryKey: ['mfa'] }));
    session.refresh().then((ok) => setStatus(ok ? 'signedIn' : 'signedOut'));
  }, [queryClient]);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me'), enabled: status === 'signedIn' });
  const mfaQuery = useQuery({
    queryKey: ['mfa'],
    queryFn: () => api.get<MfaStatus>('/auth/mfa'),
    enabled: status === 'signedIn' && !!meQuery.data?.staffProfile,
  });

  const login = useCallback(
    async (phone: string, password: string) => {
      const result = await api.post<{ user: Me; tokens: { accessToken: string } }>('/auth/login', {
        phone,
        password,
        deviceName: 'Admin panel',
        useCookie: true,
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

  // A restored session must belong to staff, and pass two-factor sign-in when it's on or required.
  const mfa = mfaQuery.data;
  let effective: Status = status;
  if (status === 'signedIn') {
    if (!me || !me.staffProfile) effective = meQuery.isError || me ? 'signedOut' : 'loading';
    else if (!mfa) effective = mfaQuery.isError ? 'signedIn' : 'loading';
    else if ((mfa.enabled || mfa.required) && !mfa.sessionVerified) effective = 'mfa';
  }
  const refreshMfa = mfaQuery.refetch;
  const value = useMemo(
    () => ({ status: effective, me, mfa, refreshMfa, login, logout, can }),
    [effective, me, mfa, refreshMfa, login, logout, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be inside AuthProvider');
  return value;
}
