'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { invitationService, type InvitationPreview } from '@/services/invitation.service';
import { useAsyncData } from '@/hooks/useAsyncData';
import { RoleLabels } from '@/config/rbac';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Public invitation acceptance page (Real Company User Invitation + Onboarding phase) - the
 * same public/unauthenticated pattern /login, /register, and /reset-password already use, since
 * the person hasn't signed in yet (or, for an existing account, doesn't need to - the token
 * itself is the credential, the same trust model /reset-password's completion step already
 * established). See invitation.service.ts's acceptInvitation for the full server-side flow.
 */
export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitationFlow />
    </Suspense>
  );
}

function AcceptInvitationFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const { data: preview, error, loading } = useAsyncData<InvitationPreview>(token ? `invite-preview-${token}` : null, () => invitationService.getPreview(token));

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  if (!token) {
    return (
      <Centered>
        <EmptyState title="Invalid invitation link" description="This link is missing its token. Ask whoever invited you for a new one." />
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </Centered>
    );
  }

  if (accepted) {
    return (
      <Centered>
        <h1 className="text-h1">You&rsquo;re in</h1>
        <p className="text-body text-text-secondary">Your account is ready. You can now sign in.</p>
        <Button onClick={() => router.push('/login')}>Go to sign in</Button>
      </Centered>
    );
  }

  if (loading) {
    return (
      <Centered>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full max-w-sm" />
      </Centered>
    );
  }

  if (error || !preview) {
    // getInvitationPreview returns one of INVALID_TOKEN/ALREADY_ACCEPTED/REVOKED/EXPIRED as its
    // error message - every one of those is safe to show verbatim (Part 21: expired/revoked/
    // already-accepted/invalid-token all need their own honest state, never a generic failure).
    return (
      <Centered>
        <EmptyState title="This invitation isn't available" description={error ?? 'This invitation link is invalid.'} />
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </Centered>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!preview!.isExistingAccount) {
      if (!name.trim()) {
        setSubmitError('Enter your name.');
        return;
      }
      if (password.length < 8) {
        setSubmitError('Choose a password with at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setSubmitError('Passwords do not match.');
        return;
      }
    }
    setSubmitting(true);
    const result = await invitationService.accept({
      token,
      name: preview!.isExistingAccount ? undefined : name.trim(),
      password: preview!.isExistingAccount ? undefined : password,
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }
    setAccepted(true);
  }

  return (
    <Centered>
      <div>
        <h1 className="text-h1">Join {preview.companyName}</h1>
        <p className="text-body text-text-secondary">
          You&rsquo;ve been invited to join <span className="font-medium">{preview.companyName}</span> as{' '}
          <span className="font-medium">{RoleLabels[preview.role]}</span>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        {submitError && (
          <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {submitError}
          </div>
        )}
        <Input label="Email" value={preview.email} disabled />
        {preview.isExistingAccount ? (
          <p className="text-caption text-text-secondary">
            This email already has an account. Accepting will add {preview.companyName} to it - your existing password stays the same.
          </p>
        ) : (
          <>
            <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Input label="Confirm password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          </>
        )}
        <Button type="submit" loading={submitting}>
          Accept invitation
        </Button>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">{children}</div>;
}
