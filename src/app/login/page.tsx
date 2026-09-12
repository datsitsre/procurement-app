'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('john.doe@acmetech.example');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = await login(email, password);
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push('/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            P
          </span>
          <span className="text-h3">Procurement</span>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-h2 mb-1">Sign in</h1>
          <p className="text-body mb-6 text-text-secondary">
            Sign in to your company&rsquo;s procurement workspace.
          </p>

          {error && (
            <div role="alert" className="mb-4 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <Input
              label="Work email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" loading={submitting} className="mt-1 w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-4 text-caption">
            Demo account: <code className="rounded bg-neutral-bg px-1 py-0.5">john.doe@acmetech.example</code> / password{' '}
            <code className="rounded bg-neutral-bg px-1 py-0.5">password123</code>
          </p>
        </div>

        <p className="mt-6 text-center text-caption">
          New company?{' '}
          <Link href="/register" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
