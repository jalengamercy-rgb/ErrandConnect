import { tokenStorage } from './token-storage';
import type { TokenPair } from './types';

/** Set EXPO_PUBLIC_API_URL in apps/mobile/.env, e.g. http://192.168.1.20:3000 to test on a phone. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** An error response from the API, with a message that can be shown to the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export const session = {
  async start(tokens: TokenPair) {
    accessToken = tokens.accessToken;
    await tokenStorage.setRefreshToken(tokens.refreshToken);
  },
  async end() {
    accessToken = null;
    await tokenStorage.clear();
  },
  /** Called when the refresh token stops working, so the app can show the login screen. */
  onExpired(listener: () => void) {
    onSessionExpired = listener;
  },
  /** Gets a fresh access token from the stored refresh token. Returns false if logged out. */
  refresh(): Promise<boolean> {
    refreshInFlight ??= (async () => {
      try {
        const refreshToken = await tokenStorage.getRefreshToken();
        if (!refreshToken) return false;
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          if (res.status === 401) await session.end();
          return false;
        }
        await session.start((await res.json()) as TokenPair);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },
};

function errorMessage(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join('\n');
  if (typeof message === 'string') return message;
  if (status >= 500) return 'Something went wrong on our side. Please try again.';
  return 'Request failed';
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function send<T>(method: Method, path: string, body?: unknown, retried = false): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach ErrandCONNECT. Check your internet connection.', null);
  }

  // Access tokens last 15 minutes; get a new one and retry once.
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await session.refresh()) return send<T>(method, path, body, true);
    onSessionExpired?.();
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status), data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown) => send<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => send<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => send<T>('PATCH', path, body),
  delete: <T>(path: string) => send<T>('DELETE', path),
};

/** URL and headers to display a private document image (e.g. in <Image source>). */
export function authorizedSource(path: string) {
  return { uri: `${API_URL}${path}`, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined };
}
