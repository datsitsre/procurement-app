'use client';

import { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { useAsyncData } from '@/hooks/useAsyncData';
import { platformUsersService, type PlatformUserRow } from '@/services/platformUsers.service';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/utils/format';

/**
 * A focused view of pending registrations (section 14), reusing the exact same
 * platformUsersService.decideRegistration() call the existing /admin/platform/users page already
 * uses - never a second approval mechanism. That page remains the place to manage suspensions and
 * platform roles; this one is just registrations, for whoever's job is specifically working
 * through the approval queue.
 */
export default function AdminApprovalsPage() {
  return (
    <AdminGuard>
      <ApprovalsQueue />
    </AdminGuard>
  );
}

function ApprovalsQueue() {
  const { data: users, error, reload } = useAsyncData<PlatformUserRow[]>('admin-approvals', () => platformUsersService.listPlatformUsers());
  const toast = useToast();
  const [actingKey, setActingKey] = useState<string | null>(null);

  const pending = users?.filter((u) => u.status === 'PENDING_APPROVAL') ?? [];
  const key = (u: PlatformUserRow) => `${u.userId}:${u.companyId}`;

  async function decide(u: PlatformUserRow, decision: 'APPROVED' | 'REJECTED') {
    setActingKey(key(u));
    const result = await platformUsersService.decideRegistration(u.userId, u.companyId, decision);
    setActingKey(null);
    if (!result.ok) return toast.show(result.error.message, 'error');
    toast.show(`${u.userName}'s registration ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`, 'success');
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Approvals</h1>
        <p className="text-body text-text-secondary">Review new company registrations awaiting platform approval.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load pending approvals" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : users === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : pending.length === 0 ? (
        <EmptyState icon={UserCheck} title="No pending approvals" description="New registrations awaiting review will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-table">
            <thead>
              <tr className="text-metadata">
                <th className="p-4 text-left">Name</th>
                <th className="p-4 text-left">Email</th>
                <th className="p-4 text-left">Company</th>
                <th className="p-4 text-left">Submitted</th>
                <th className="p-4 text-left">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={key(u)} className="border-t border-border">
                  <td className="p-4 font-medium">{u.userName}</td>
                  <td className="p-4 text-text-secondary">{u.userEmail}</td>
                  <td className="p-4">{u.companyName}</td>
                  <td className="p-4 text-text-secondary">{formatDate(u.createdAt)}</td>
                  <td className="p-4">
                    <Badge tone="warning">Pending approval</Badge>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" loading={actingKey === key(u)} onClick={() => decide(u, 'REJECTED')}>
                        Reject
                      </Button>
                      <Button size="sm" loading={actingKey === key(u)} onClick={() => decide(u, 'APPROVED')}>
                        Approve
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
