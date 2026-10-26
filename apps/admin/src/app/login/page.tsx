'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { status, login } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'signedIn' || status === 'mfa') router.replace('/');
  }, [status, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6">
        <div>
          <h1 className="text-xl font-bold">
            Errand<span className="text-brand">CONNECT</span> Admin
          </h1>
          <p className="text-sm text-muted">Staff sign in</p>
        </div>
        <Field label="Phone number">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="tel" required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </main>
  );
}
