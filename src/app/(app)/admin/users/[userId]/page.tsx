'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, MoreHorizontal, Shield, Users2 } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { ActivityDetailsDialog } from '@/features/admin/ActivityDetailsDialog';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { platformUsersService, type UserDetail, type UserMembershipDetail } from '@/services/platformUsers.service';
import { auditLogService } from '@/services/audit-log.service';
import { describeActivity } from '@/lib/activityFeed';
import { Permission, Role } from '@/config/rbac';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatDateTime } from '@/utils/format';
import type { AuditEntry } from '@/types/common';

const ROLE_LABEL: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: 'Super Admin',
  PLATFORM_ADMIN: 'Admin (legacy)',
  PLATFORM_MANAGER: 'Platform Manager',
  OWNER: 'Owner',
  ADMIN: 'Admin',
  PROCUREMENT_MANAGER: 'Procurement Manager',
  BUYER: 'Buyer',
  FINANCE_MANAGER: 'Finance Manager',
  APPROVER: 'Approver',
  EMPLOYEE: 'Employee',
  SUPPLIER_ADMIN: 'Supplier Admin',
  SUPPLIER_STAFF: 'Supplier Staff',
};

/**
 * A single user's full cross-company picture (Platform Users Management follow-up), styled after
 * the Company Detail page's own header/tab/card language. GET /api/admin/users/[userId],
 * PLATFORM_USERS_MANAGE. Every mutation (suspend/activate a membership, change a platform role)
 * calls the exact same server functions the /admin/platform/users queue already uses
 * (setMembershipStatus/changePlatformRole via platformUsersService) - this page never duplicates
 * that authorization or audit logic, it only presents it per-membership instead of in one flat
 * queue. Self-protection (can't suspend/demote yourself) and the platform-role hierarchy guard
 * (a Manager can't touch a Super Admin's account) are enforced server-side in those same
 * functions - see platformUsers.service.ts's own comments.
 */
export default function UserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return (
    <AdminGuard>
      <UserDetail userId={userId} />
    </AdminGuard>
  );
}

function UserDetail({ userId }: { userId: string }) {
  const router = useRouter();
  const { session, can } = useAuth();
  const toast = useToast();
  const { data: user, loading, error, reload } = useAsyncData<UserDetail>(userId, () => platformUsersService.getUserDetail(userId));
  const [tab, setTab] = useState('overview');
  const [confirming, setConfirming] = useState<{ membership: UserMembershipDetail; status: 'SUSPENDED' | 'ACTIVE' } | null>(null);

  if (error) return <ErrorState title="Couldn't load this user" description={error} secondaryAction={{ label: 'Back to users', onClick: () => router.push('/admin/users') }} />;
  if (loading || !user) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const isSelf = session?.user.id === userId;
  const canManageUsers = can(Permission.PLATFORM_USERS_MANAGE);
  const canManageRoles = can(Permission.PLATFORM_ROLES_MANAGE);
  const primary = user.memberships[0];

  async function handleSetStatus() {
    if (!confirming) return;
    const result = await platformUsersService.setMembershipStatus(userId, confirming.membership.companyId, confirming.status);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    setConfirming(null);
    toast.show(`${user!.name} ${confirming.status === 'ACTIVE' ? 'reactivated' : 'suspended'}.`, 'success');
    reload();
  }

  async function changeRole(membership: UserMembershipDetail, role: 'PLATFORM_MANAGER' | 'PLATFORM_SUPER_ADMIN') {
    const result = await platformUsersService.changePlatformRole(userId, membership.companyId, role);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(`${user!.name} is now ${role === 'PLATFORM_SUPER_ADMIN' ? 'a platform super admin' : 'a platform manager'}.`, 'success');
    reload();
  }

  function copyId() {
    navigator.clipboard.writeText(userId);
    toast.show('User ID copied.', 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Breadcrumb items={[{ label: 'Users', href: '/admin/users' }, { label: user.name }]} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} imageUrl={user.avatarUrl} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-h1">{user.name}</h1>
                {primary && <StatusBadge domain="membership" status={primary.status} />}
              </div>
              <p className="text-body text-text-secondary">
                {user.email}
                {primary && ` · ${ROLE_LABEL[primary.role] ?? primary.role}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canManageUsers && primary && !isSelf && (
              primary.status === 'SUSPENDED' ? (
                <Button size="sm" onClick={() => setConfirming({ membership: primary, status: 'ACTIVE' })}>
                  Activate
                </Button>
              ) : primary.status === 'ACTIVE' ? (
                <Button variant="danger" size="sm" onClick={() => setConfirming({ membership: primary, status: 'SUSPENDED' })}>
                  Suspend
                </Button>
              ) : null
            )}
            <Button variant="outline" size="sm" onClick={() => setTab('access')}>
              View access
            </Button>
            <DropdownMenu
              trigger={
                <Button variant="outline" size="sm" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              }
            >
              <DropdownMenuItem onClick={() => setTab('access')}>View access</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTab('activity')}>View activity</DropdownMenuItem>
              <DropdownMenuItem onClick={copyId}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy user ID
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>
        {isSelf && (
          <p className="text-caption text-text-tertiary">This is your own account - you can&apos;t change your own status or role here.</p>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'activity', label: 'Activity' },
          { value: 'access', label: 'Access' },
        ]}
      >
        {(t) =>
          t === 'overview' ? (
            <OverviewTab user={user} />
          ) : t === 'activity' ? (
            <ActivityTab userId={userId} />
          ) : (
            <AccessTab
              user={user}
              isSelf={isSelf}
              canManageUsers={canManageUsers}
              canManageRoles={canManageRoles}
              onRequestStatus={(membership, status) => setConfirming({ membership, status })}
              onChangeRole={changeRole}
            />
          )
        }
      </Tabs>

      <ConfirmationDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={handleSetStatus}
        title={confirming?.status === 'SUSPENDED' ? 'Suspend this user?' : 'Activate this user?'}
        description={
          confirming?.status === 'SUSPENDED'
            ? `${user.name} will keep their account but lose access to ${confirming.membership.companyName} until reactivated.`
            : confirming
              ? `${user.name} will regain full access to ${confirming.membership.companyName}.`
              : undefined
        }
        confirmLabel={confirming?.status === 'SUSPENDED' ? 'Suspend user' : 'Activate user'}
        destructive={confirming?.status === 'SUSPENDED'}
      />
    </div>
  );
}

function OverviewTab({ user }: { user: UserDetail }) {
  const activeCount = user.memberships.filter((m) => m.status === 'ACTIVE').length;
  const platformMembership = user.memberships.find((m) => m.isPlatform);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Memberships" value={String(user.memberships.length)} icon={Users2} />
        <StatCard label="Active memberships" value={String(activeCount)} icon={Users2} />
        <StatCard label="Platform role" value={platformMembership ? ROLE_LABEL[platformMembership.role] ?? platformMembership.role : 'None'} icon={Shield} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Name" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field label="Phone" value={user.phone} />
            <Field label="Registered" value={formatDate(user.createdAt)} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-metadata">{label}</dt>
      <dd className="text-sm font-medium">{value || '—'}</dd>
    </div>
  );
}

function AccessTab({
  user,
  isSelf,
  canManageUsers,
  canManageRoles,
  onRequestStatus,
  onChangeRole,
}: {
  user: UserDetail;
  isSelf: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
  onRequestStatus: (membership: UserMembershipDetail, status: 'SUSPENDED' | 'ACTIVE') => void;
  onChangeRole: (membership: UserMembershipDetail, role: 'PLATFORM_MANAGER' | 'PLATFORM_SUPER_ADMIN') => void;
}) {
  if (user.memberships.length === 0) {
    return <EmptyState icon={Users2} title="No memberships" description="This user doesn't belong to any organization yet." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {user.memberships.map((m) => (
        <Card key={m.companyId}>
          <CardHeader>
            <div>
              <CardTitle>{m.companyName}</CardTitle>
              <p className="text-caption mt-1">
                {m.isPlatform ? 'Platform account' : m.isSupplier ? 'Supplier organization' : 'Buyer organization'}
                {m.department ? ` · ${m.department}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{ROLE_LABEL[m.role] ?? m.role}</Badge>
              <StatusBadge domain="membership" status={m.status} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Joined" value={m.joinedAt ? formatDate(m.joinedAt) : undefined} />
              <Field label="Invited" value={m.invitedAt ? formatDate(m.invitedAt) : undefined} />
            </dl>
            {!isSelf && (
              <div className="flex flex-wrap items-center gap-2">
                {canManageUsers && m.status === 'ACTIVE' && (
                  <Button variant="danger" size="sm" onClick={() => onRequestStatus(m, 'SUSPENDED')}>
                    Suspend
                  </Button>
                )}
                {canManageUsers && m.status === 'SUSPENDED' && (
                  <Button size="sm" onClick={() => onRequestStatus(m, 'ACTIVE')}>
                    Activate
                  </Button>
                )}
                {canManageRoles && m.isPlatform && (m.role === Role.PLATFORM_MANAGER || m.role === Role.PLATFORM_SUPER_ADMIN) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onChangeRole(m, m.role === Role.PLATFORM_MANAGER ? 'PLATFORM_SUPER_ADMIN' : 'PLATFORM_MANAGER')}
                  >
                    {m.role === Role.PLATFORM_MANAGER ? 'Promote to super admin' : 'Demote to manager'}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ActivityTab({ userId }: { userId: string }) {
  const { data, loading, error } = useAsyncData(userId, () => auditLogService.listEntries(null, 100));
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const entries = (data?.items ?? []).filter((e) => e.actorId === userId || e.entityId === userId);

  if (error) return <ErrorState title="Couldn't load activity" description={error} />;
  if (loading) return <SkeletonTable rows={4} columns={3} />;
  if (entries.length === 0) {
    return <EmptyState icon={Users2} title="No activity yet" description="Actions this user took, or actions taken on this user's account, will appear here." />;
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => {
          const { label, icon: Icon } = describeActivity(e);
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSelected(e)}
                className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left text-sm hover:bg-neutral-bg"
              >
                <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span className="flex-1">
                  <span className="font-medium">{e.actorName}</span> {label}
                </span>
                <span className="text-caption shrink-0">{formatDateTime(e.timestamp)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <ActivityDetailsDialog entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}
