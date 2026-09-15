'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { companiesOf, type Session } from '@/services/auth.service';
import { RoleLabels, workspaceForRole, type Workspace } from '@/config/rbac';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/utils/cn';

/** One membership matching the selected workspace, paired with its company's display name -
 *  what the picker below actually needs, resolved once the account and its memberships are
 *  known rather than re-deriving it inline in JSX. */
interface WorkspaceMatch {
  companyId: string;
  companyName: string;
  role: string;
}

function matchingMemberships(session: Session, workspace: 'buyer' | 'supplier'): WorkspaceMatch[] {
  const companies = companiesOf(session);
  return session.memberships
    .filter((m) => workspaceForRole(m.role) === (workspace as Workspace))
    .map((m) => ({ companyId: m.companyId, companyName: companies.find((c) => c.id === m.companyId)?.name ?? 'Unknown company', role: RoleLabels[m.role] }));
}

const DEMO_ACCOUNTS: Record<'buyer' | 'supplier', { email: string; label: string }> = {
  buyer: { email: 'john.doe@acmetech.example', label: 'company user' },
  supplier: { email: 'adwoa.mensah@abctech.example', label: 'supplier' },
};

export default function LoginPage() {
  const router = useRouter();
  const { session, login, switchCompany } = useAuth();
  // Which kind of account this sign-in is for. A single login (email + password) can't itself
  // tell buyer from supplier - it only knows which company memberships the account has, and
  // which one lands active by default (whichever the backend picked first) may not be the one
  // being signed in for. This picks which membership to make active after a successful login,
  // rather than leaving that to chance - see the effect below.
  const [workspace, setWorkspace] = useState<'buyer' | 'supplier'>('buyer');
  // Deliberately empty, not pre-filled with a real demo account (see the "Demo account" hint
  // below the form instead) - a pre-filled value here meant switching accounts silently logged
  // you back in as whoever was pre-filled unless you noticed and cleared it first.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error` (a failed sign-in) - this account signed in fine, just doesn't have the
  // workspace kind that was selected. Shown with a "Continue" the visitor acts on, rather than
  // auto-navigating past a message they'd have no chance to actually read.
  const [noWorkspaceNotice, setNoWorkspaceNotice] = useState<string | null>(null);
  // Set only when the account has more than one membership matching the selected workspace (e.g.
  // an owner/manager across several buyer companies) - there's no way to infer which one was
  // meant from email + password alone, so this makes the visitor pick rather than silently
  // landing in whichever one the backend happened to return first.
  const [companyChoices, setCompanyChoices] = useState<WorkspaceMatch[] | null>(null);
  const [choosingCompany, setChoosingCompany] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // `login()` only reports success/failure, not the resulting session (useAuth's `session`
  // updates on its own render cycle, not synchronously after `await login(...)`) - so the
  // workspace-matching switch below has to happen in an effect once `session` actually changes,
  // gated by this flag so it only fires right after a login this page itself triggered, not on
  // every session update for any other reason.
  const awaitingWorkspaceMatch = useRef(false);

  useEffect(() => {
    if (!awaitingWorkspaceMatch.current || !session) return;
    awaitingWorkspaceMatch.current = false;

    // Resolved from a Promise callback, not directly in the effect body - same rule
    // useAsyncData's own fetch callback follows: React's guidance is to call setState "in a
    // callback function when external state changes", not synchronously while handling the
    // change itself.
    Promise.resolve().then(async () => {
      const matches = matchingMemberships(session, workspace);
      if (matches.length === 0) {
        setNoWorkspaceNotice(`This account has no ${workspace} workspace - it's signed in with what it does have instead.`);
        return;
      }
      if (matches.length > 1) {
        setCompanyChoices(matches);
        return;
      }
      if (matches[0].companyId !== session.activeCompanyId) {
        await switchCompany(matches[0].companyId);
      }
      router.push('/dashboard');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per login attempt, keyed on session changing; `workspace` is read at trigger time via the ref guard, not meant to re-run if it changes afterward
  }, [session]);

  async function chooseCompany(companyId: string) {
    setChoosingCompany(companyId);
    await switchCompany(companyId);
    router.push('/dashboard');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNoWorkspaceNotice(null);
    setCompanyChoices(null);
    awaitingWorkspaceMatch.current = true;
    const err = await login(email, password);
    setSubmitting(false);
    if (err) {
      awaitingWorkspaceMatch.current = false;
      setError(err.message);
    }
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
          <p className="text-body mb-4 text-text-secondary">
            Sign in to your company&rsquo;s procurement workspace.
          </p>

          <div role="radiogroup" aria-label="Sign in as" className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-neutral-bg p-1">
            {(['buyer', 'supplier'] as const).map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={workspace === w}
                onClick={() => setWorkspace(w)}
                className={cn(
                  'rounded-md py-1.5 text-sm font-medium transition-colors',
                  workspace === w ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {w === 'buyer' ? 'Company user' : 'Supplier'}
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="mb-4 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          {noWorkspaceNotice && (
            <div role="status" className="mb-4 flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
              <p>{noWorkspaceNotice}</p>
              <Button size="sm" variant="outline" className="w-fit" onClick={() => router.push('/dashboard')}>
                Continue
              </Button>
            </div>
          )}

          {companyChoices ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-secondary">
                This account has more than one {workspace} company - which one do you want to sign into?
              </p>
              <ul className="flex flex-col gap-2">
                {companyChoices.map((choice) => (
                  <li key={choice.companyId}>
                    <button
                      type="button"
                      onClick={() => chooseCompany(choice.companyId)}
                      disabled={choosingCompany !== null}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5 text-left text-sm hover:bg-neutral-bg disabled:opacity-60"
                    >
                      <span className="font-medium">{choice.companyName}</span>
                      <span className="text-caption">{choosingCompany === choice.companyId ? 'Signing in…' : choice.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <Input
                  label="Work email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.example"
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
                Demo {DEMO_ACCOUNTS[workspace].label} account:{' '}
                <code className="rounded bg-neutral-bg px-1 py-0.5">{DEMO_ACCOUNTS[workspace].email}</code> / password{' '}
                <code className="rounded bg-neutral-bg px-1 py-0.5">password123</code>
              </p>
            </>
          )}
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
