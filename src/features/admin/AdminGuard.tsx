'use client';

import { useWorkspace } from '@/hooks/useAuth';
import { ErrorState } from '@/components/ui/ErrorState';

/**
 * Every /admin/* page wraps its content in this - the sidebar/nav already hides these routes
 * from anyone but a PLATFORM_ADMIN (config/navigation.ts's platformNav), but per section 37/46
 * a hidden nav link is a UX convenience, never the access boundary. Someone who types the URL
 * directly still gets refused here, the same way every mutating mock service call re-checks
 * assertPermission regardless of what the UI already hid.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const workspace = useWorkspace();

  if (workspace !== 'platform') {
    return (
      <ErrorState
        title="Not available"
        description="This page is part of the platform administration workspace."
      />
    );
  }

  return <>{children}</>;
}
