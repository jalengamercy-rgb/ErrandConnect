import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, session } from './api';
import type { AuthResult, Me } from './types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: Status;
  /** The logged-in user; always set when status is 'signedIn'. */
  me: Me | undefined;
  signIn(result: AuthResult): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ['me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');

  // On launch, use the saved refresh token to restore the session.
  useEffect(() => {
    session.onExpired(() => {
      queryClient.clear();
      setStatus('signedOut');
    });
    session.refresh().then((ok) => setStatus(ok ? 'signedIn' : 'signedOut'));
  }, [queryClient]);

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<Me>('/me'),
    enabled: status === 'signedIn',
  });

  const signIn = useCallback(
    async (result: AuthResult) => {
      await session.start(result.tokens);
      queryClient.setQueryData(ME_QUERY_KEY, result.user);
      setStatus('signedIn');
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    await session.end();
    queryClient.clear();
    setStatus('signedOut');
  }, [queryClient]);

  // Stay on the splash state until the profile has loaded after restoring a session.
  const effectiveStatus = status === 'signedIn' && !meQuery.data ? (meQuery.isError ? 'signedOut' : 'loading') : status;

  const value = useMemo(
    () => ({ status: effectiveStatus, me: meQuery.data, signIn, signOut }),
    [effectiveStatus, meQuery.data, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
