'use client';

import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBox, Field, Input, Notice } from './ui';

/** Shown instead of the panel until the staff member sets up or enters two-factor sign-in. */
export function TwoFactorScreen() {
  const { mfa, logout } = useAuth();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-6">
        <div>
          <h1 className="text-xl font-bold">Two-factor sign-in</h1>
          <p className="text-sm text-muted">
            {mfa?.enabled
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Staff accounts need a second step to sign in, using an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy…).'}
          </p>
        </div>
        {mfa?.enabled ? <Verify /> : <Setup />}
        <Button variant="ghost" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}

function Verify() {
  const { refreshMfa } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/verify', { code: code.trim() });
      await refreshMfa();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Code" hint="Lost your phone? Enter one of your recovery codes instead.">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={12}
        />
      </Field>
      <ErrorBox error={error} />
      <Button type="submit" loading={busy} disabled={code.trim().length < 6} className="w-full">
        Continue
      </Button>
    </form>
  );
}

function Setup() {
  const { refreshMfa } = useAuth();
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (secret) void QRCode.toDataURL(secret.uri, { margin: 1, width: 200 }).then(setQr);
  }, [secret]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSecret(await api.post<{ secret: string; uri: string }>('/auth/mfa/setup'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRecoveryCodes((await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code: code.trim() })).recoveryCodes);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="space-y-3">
        <Notice>
          Two-factor sign-in is on. Save these recovery codes somewhere safe: each one works once if you lose your phone. They won&apos;t be
          shown again.
        </Notice>
        <ul className="grid grid-cols-2 gap-1 rounded-lg border border-border p-3 font-mono text-sm" aria-label="Recovery codes">
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button className="w-full" onClick={() => void refreshMfa()}>
          I&apos;ve saved them, continue
        </Button>
      </div>
    );
  }
  if (!secret) {
    return (
      <>
        <ErrorBox error={error} />
        <Button className="w-full" onClick={() => void start()} loading={busy}>
          Set up now
        </Button>
      </>
    );
  }
  return (
    <form onSubmit={confirm} className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Open your authenticator app and add an account.</li>
        <li>Scan this code, or type the key below.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
      {qr && <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="mx-auto rounded bg-white" />}
      <p className="break-all text-center font-mono text-sm" aria-label="Setup key">
        {secret.secret.match(/.{1,4}/g)?.join(' ')}
      </p>
      <Field label="Code from the app">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
        />
      </Field>
      <ErrorBox error={error} />
      <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">
        Turn on
      </Button>
    </form>
  );
}
