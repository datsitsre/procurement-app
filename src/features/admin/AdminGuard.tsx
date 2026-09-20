'use client';

import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/hooks/useAuth';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Every /admin/* page wraps its content in this - the sidebar/nav already hides these routes
 * from anyone but a platform-tier role (config/navigation.ts's platformNav), but per section
 * 37/46 a hidden nav link is a UX convenience, never the access boundary. Someone who types the
 * URL directly still gets refused here, the same way every mutating mock service call re-checks
 * assertPermission regardless of what the UI already hid - and the page's own API calls remain
 * gated server-side (requireAuthenticated + the route's own permission) regardless of what this
 * component decides to render.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const workspace = useWorkspace();

  if (workspace !== 'platform') {
    return (
      <ErrorState
        title="You don't have access to this page"
        description="Platform administration is only available to platform accounts. If you believe this is a mistake, contact your platform administrator."
        secondaryAction={{ label: 'Back to dashboard', onClick: () => router.push('/dashboard') }}
      />
    );
  }

  return <>{children}</>;
}
