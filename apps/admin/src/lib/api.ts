/** Set NEXT_PUBLIC_API_URL in apps/admin/.env.local */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const REFRESH_KEY = 'errandconnect.admin.refreshToken';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onExpired: (() => void) | null = null;

const storage = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(REFRESH_KEY)),
  set: (token: string) => window.localStorage.setItem(REFRESH_KEY, token),
  clear: () => window.localStorage.removeItem(REFRESH_KEY),
};

/**
 * Login session. The access token stays in memory; the refresh token is
 * kept in localStorage so a page reload keeps you signed in.
 */
export const session = {
  start(tokens: TokenPair) {
    accessToken = tokens.accessToken;
    storage.set(tokens.refreshToken);
  },
  end() {
    accessToken = null;
    storage.clear();
  },
  onExpired(listener: () => void) {
    onExpired = listener;
  },
  refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const refreshToken = storage.get();
        if (!refreshToken) return false;
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          if (res.status === 401) session.end();
          return false;
        }
        session.start(await res.json());
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  },
};

function messageFrom(body: unknown, status: number) {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join('\n');
  if (typeof message === 'string') return message;
  return status >= 500 ? 'Server error. Please try again.' : 'Request failed';
}

async function send(method: string, path: string, body?: unknown, retried = false): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Cannot reach the API. Is it running?');
  }
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await session.refresh()) return send(method, path, body, true);
    onExpired?.();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, messageFrom(data, res.status));
  }
  return res;
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(path: string) => json<T>('GET', path),
  post: <T>(path: string, body?: unknown) => json<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => json<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => json<T>('PATCH', path, body),
  delete: <T>(path: string) => json<T>('DELETE', path),
  /** Downloads a file (CSV, document image) with the login token. */
  blob: async (path: string) => (await send('GET', path)).blob(),
};

/** Builds "?a=1&b=2", skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}

export interface Page<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}
