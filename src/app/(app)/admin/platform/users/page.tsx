'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { useAuth, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { platformUsersService, type PlatformUserRow } from '@/services/platformUsers.service';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/utils/format';

const ROLE_TONE: Record<string, NonNullable<BadgeProps['tone']>> = {
  PLATFORM_SUPER_ADMIN: 'info',
  PLATFORM_ADMIN: 'info',
  PLATFORM_MANAGER: 'neutral',
};
const ROLE_LABEL: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Admin (legacy)',
  PLATFORM_MANAGER: 'Manager',
};
const STATUS_TONE: Record<string, NonNullable<BadgeProps['tone']>> = {
  PENDING_APPROVAL: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  REJECTED: 'danger',
  INVITED: 'neutral',
};

/**
 * Platform user administration (Phase 26) - the platform's own moderation queue: pending
 * self-registrations, suspended/rejected memberships, and anyone holding a platform-tier role.
 * Every action here calls a server route that re-derives and re-checks authorization itself
 * (see platformUsers.service.ts on the server) - this page's own role check below only controls
 * which buttons are *shown*, never which actions actually succeed; hiding the "change role"
 * button from a PLATFORM_MANAGER is a UX convenience, not the security boundary (the API would
 * refuse the same request with a 403 either way).
 */
export default function AdminPlatformUsersPage() {
  return (
    <AdminGuard>
      <PlatformUsersQueue />
    </AdminGuard>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: 'Pending approval',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
  INVITED: 'Invited',
};

function PlatformUsersQueue() {
  const membership = useActiveMembership();
  const { session } = useAuth();
  const isSuperAdmin = membership?.role === 'PLATFORM_SUPER_ADMIN' || membership?.role === 'PLATFORM_ADMIN';
  const { data: users, reload } = useAsyncData<PlatformUserRow[]>('admin-platform-users', () => platformUsersService.listPlatformUsers());
  const toast = useToast();
  const [actingKey, setActingKey] = useState<string | null>(null);

  const key = (u: PlatformUserRow) => `${u.userId}:${u.companyId}`;

  async function decideRegistration(u: PlatformUserRow, decision: 'APPROVED' | 'REJECTED') {
    setActingKey(key(u));
    const result = await platformUsersService.decideRegistration(u.userId, u.companyId, decision);
    setActingKey(null);
    if (!result.ok) return toast.show(result.error.message, 'error');
    toast.show(`${u.userName}'s registration ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`, 'success');
    reload();
  }

  async function setStatus(u: PlatformUserRow, status: 'SUSPENDED' | 'ACTIVE') {
    setActingKey(key(u));
    const result = await platformUsersService.setMembershipStatus(u.userId, u.companyId, status);
    setActingKey(null);
    if (!result.ok) return toast.show(result.error.message, 'error');
    toast.show(`${u.userName} ${status === 'ACTIVE' ? 'reactivated' : 'suspended'}.`, 'success');
    reload();
  }

  async function changeRole(u: PlatformUserRow, role: 'PLATFORM_MANAGER' | 'PLATFORM_SUPER_ADMIN') {
    setActingKey(key(u));
    const result = await platformUsersService.changePlatformRole(u.userId, u.companyId, role);
    setActingKey(null);
    if (!result.ok) return toast.show(result.error.message, 'error');
    toast.show(`${u.userName} is now ${role === 'PLATFORM_SUPER_ADMIN' ? 'a platform super admin' : 'a platform manager'}.`, 'success');
    reload();
  }

  const pending = users?.filter((u) => u.status === 'PENDING_APPROVAL') ?? [];
  const others = users?.filter((u) => u.status !== 'PENDING_APPROVAL') ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Platform users</h1>
        <p className="text-body text-text-secondary">
          Pending registrations, suspended accounts, and platform-tier roles. This is not a directory of every company&apos;s own team -
          see each company&apos;s own Team page for that.
        </p>
      </div>

      {users === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="Nothing needs attention" description="No pending registrations, suspensions, or platform accounts to review." />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-h3">Pending registrations</p>
              {pending.map((u) => (
                <div key={key(u)} className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-bg p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-semibold">{u.userName}</p>
                    <p className="text-caption">
                      {u.userEmail} · {u.companyName} · requested {formatDate(u.createdAt)}
                    </p>
                    <Badge tone="warning" className="w-fit">Pending approval</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" loading={actingKey === key(u)} onClick={() => decideRegistration(u, 'REJECTED')}>
                      Reject
                    </Button>
                    <Button size="sm" loading={actingKey === key(u)} onClick={() => decideRegistration(u, 'APPROVED')}>
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-h3">Suspended, rejected, and platform accounts</p>
            {others.length === 0 ? (
              <p className="text-caption text-text-secondary">None right now.</p>
            ) : (
              others.map((u) => (
                <div key={key(u)} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-semibold">{u.userName}</p>
                    <p className="text-caption">
                      {u.userEmail} · {u.companyName}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {ROLE_TONE[u.role] && <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role] ?? u.role}</Badge>}
                      <Badge tone={STATUS_TONE[u.status] ?? 'neutral'}>{STATUS_LABEL[u.status] ?? u.status}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.status === 'ACTIVE' && (
                      <Button size="sm" variant="outline" loading={actingKey === key(u)} onClick={() => setStatus(u, 'SUSPENDED')}>
                        Suspend
                      </Button>
                    )}
                    {u.status === 'SUSPENDED' && (
                      <Button size="sm" loading={actingKey === key(u)} onClick={() => setStatus(u, 'ACTIVE')}>
                        Reactivate
                      </Button>
                    )}
                    {/* Role management is PLATFORM_SUPER_ADMIN-only - hidden here for a
                        PLATFORM_MANAGER as a UX convenience; the API enforces this independently. */}
                    {isSuperAdmin && (u.role === 'PLATFORM_MANAGER' || u.role === 'PLATFORM_SUPER_ADMIN') && u.userId !== session?.user.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={actingKey === key(u)}
                        onClick={() => changeRole(u, u.role === 'PLATFORM_MANAGER' ? 'PLATFORM_SUPER_ADMIN' : 'PLATFORM_MANAGER')}
                      >
                        {u.role === 'PLATFORM_MANAGER' ? 'Promote to super admin' : 'Demote to manager'}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
