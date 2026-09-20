'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { authService } from '@/services/auth.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/** Completes a password reset (Part B6 - Company User Management follow-up) - the page a reset
 *  link/token points at. Public/unauthenticated, the same as /login and /register, since the
 *  person hasn't signed in yet; the token itself (not a session) is what proves who this is. */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await authService.completePasswordReset(token, newPassword);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDone(true);
  }

  if (!token) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
        <h1 className="text-h1">Invalid reset link</h1>
        <p className="text-body text-text-secondary">This reset link is missing its token. Ask whoever sent it for a new one.</p>
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
        <h1 className="text-h1">Password updated</h1>
        <p className="text-body text-text-secondary">Your password has been reset. You can now sign in with your new password.</p>
        <Button onClick={() => router.push('/login')}>Go to sign in</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
      <div>
        <h1 className="text-h1">Set a new password</h1>
        <p className="text-body text-text-secondary">Choose a new password for your account.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <Input label="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        <Input label="Confirm new password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        <Button type="submit" loading={submitting}>
          Set new password
        </Button>
      </form>
    </div>
  );
}
