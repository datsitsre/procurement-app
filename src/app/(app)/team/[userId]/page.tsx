'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, MoreHorizontal } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { companyService, type TeamMember } from '@/services/company.service';
import { auditLogService } from '@/services/audit-log.service';
import { describeActivity } from '@/lib/activityFeed';
import { RoleLabels, type Role } from '@/config/rbac';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { Dialog } from '@/components/ui/Dialog';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatDateTime } from '@/utils/format';
import { EditTeamMemberForm } from '../page';

/**
 * A single company team member's detail page (Part B10 - Company User Management), scoped
 * entirely to the caller's own active company - never a second, platform-wide user directory
 * (that's /admin/users). Reuses listTeamMembers(companyId) to find this one member (the same
 * "fetch the list, find by id" pattern the Supplier Detail page already uses) rather than adding
 * a new single-member GET route - this company's team list is already small and already fully
 * tenant-scoped server-side. Every mutation (edit/suspend/activate/offboard/reset password) calls
 * the exact same company.service.ts functions the /team list page already uses.
 */
export default function TeamMemberDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return <TeamMemberDetail userId={userId} />;
}

function TeamMemberDetail({ userId }: { userId: string }) {
  const router = useRouter();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const { session } = useAuth();
  const toast = useToast();

  const { data: members, error, reload } = useAsyncData<TeamMember[]>(
    company ? `team-detail-${company.id}` : null,
    () => companyService.listTeamMembers(company!.id, membership!.role),
  );
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<'suspend' | 'activate' | 'offboard' | null>(null);
  const [resetResult, setResetResult] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (error) {
    return (
      <ErrorState
        title="You don't have access to this page"
        description="Viewing team members requires the users.manage permission - ask a company owner or administrator."
        secondaryAction={{ label: 'Back to team', onClick: () => router.push('/team') }}
      />
    );
  }
  if (!company || !membership || members === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const member = members.find((m) => m.user.id === userId);
  if (!member) {
    return <EmptyState title="Team member not found" description="This person may no longer belong to this company." />;
  }

  const isSelf = member.user.id === session?.user.id;
  const companyId = company.id;

  async function handleConfirm() {
    if (!confirming) return;
    const result =
      confirming === 'suspend'
        ? await companyService.suspendTeamMember(companyId, userId)
        : confirming === 'activate'
          ? await companyService.activateTeamMember(companyId, userId)
          : await companyService.offboardTeamMember(companyId, userId);
    setConfirming(null);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(
      confirming === 'suspend' ? `${member!.user.name} suspended.` : confirming === 'activate' ? `${member!.user.name} reactivated.` : `${member!.user.name} offboarded.`,
      'success',
    );
    reload();
  }

  async function handleResetPassword() {
    const result = await companyService.requestTeamMemberPasswordReset(companyId, userId);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    setResetResult(result.data);
  }

  async function copyToken() {
    if (!resetResult) return;
    await navigator.clipboard.writeText(resetResult.token).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Breadcrumb items={[{ label: 'Team', href: '/team' }, { label: member.user.name }]} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={member.user.name} imageUrl={member.user.avatarUrl} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-h1">{member.user.name}</h1>
                <StatusBadge domain="membership" status={member.membership.status} />
              </div>
              <p className="text-body text-text-secondary">
                {member.user.email} · {RoleLabels[member.membership.role]}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={handleResetPassword}>
              Reset password
            </Button>
            {!isSelf && member.membership.status === 'ACTIVE' && (
              <Button variant="danger" size="sm" onClick={() => setConfirming('suspend')}>
                Suspend
              </Button>
            )}
            {!isSelf && member.membership.status !== 'ACTIVE' && (
              <Button size="sm" onClick={() => setConfirming('activate')}>
                Activate
              </Button>
            )}
            <DropdownMenu
              trigger={
                <Button variant="outline" size="sm" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              }
            >
              {!isSelf && member.membership.status !== 'SUSPENDED' && (
                <DropdownMenuItem destructive onClick={() => setConfirming('offboard')}>
                  Offboard
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          </div>
        </div>
        {isSelf && <p className="text-caption text-text-tertiary">This is your own account - you can&apos;t suspend or offboard yourself here.</p>}
      </div>

      {resetResult && (
        <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm">
          <p className="font-medium text-warning">Password reset requested for {member.user.email} - share this link/token with them now.</p>
          <p className="text-warning">It won&rsquo;t be shown again after you leave this page. They&rsquo;ll set a new password themselves.</p>
          <div className="flex items-center gap-2">
            <code className="overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs">{resetResult.token}</code>
            <Button size="sm" variant="outline" onClick={copyToken}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button size="sm" variant="ghost" className="w-fit" onClick={() => setResetResult(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'activity', label: 'Activity' },
          { value: 'access', label: 'Access' },
        ]}
      >
        {(t) => (t === 'overview' ? <OverviewTab member={member} /> : t === 'activity' ? <ActivityTab companyId={companyId} userId={userId} /> : <AccessTab member={member} />)}
      </Tabs>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit team member" size="md">
        <EditTeamMemberForm
          companyId={companyId}
          callerRole={membership.role as Role}
          member={member}
          onDone={() => {
            setEditing(false);
            reload();
          }}
          onCancel={() => setEditing(false)}
        />
      </Dialog>

      <ConfirmationDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={handleConfirm}
        title={confirming === 'suspend' ? 'Suspend this user?' : confirming === 'activate' ? 'Activate this user?' : 'Offboard this user?'}
        description={
          confirming === 'suspend'
            ? `${member.user.name} will keep their account but lose access to this company's workspace until reactivated.`
            : confirming === 'activate'
              ? `${member.user.name} will regain their previous access to this company's workspace.`
              : `This will remove ${member.user.name}'s active access to this organization. Historical activity and records will be preserved.`
        }
        confirmLabel={confirming === 'suspend' ? 'Suspend user' : confirming === 'activate' ? 'Activate user' : 'Offboard user'}
        destructive={confirming === 'suspend' || confirming === 'offboard'}
      />
    </div>
  );
}

function OverviewTab({ member }: { member: TeamMember }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>User information</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Name" value={member.user.name} />
          <Field label="Email" value={member.user.email} />
          <Field label="Phone" value={member.user.phone} />
          <Field label="Role" value={RoleLabels[member.membership.role]} />
          <Field label="Department" value={member.membership.department} />
          <Field label="Joined" value={member.membership.joinedAt ? formatDate(member.membership.joinedAt) : undefined} />
        </dl>
      </CardContent>
    </Card>
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

function AccessTab({ member }: { member: TeamMember }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Access</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Deliberately shows only this one company's own membership - a company admin is never
            shown another company this person might also belong to (this page's own data source,
            listTeamMembers(companyId), can never return a cross-company row to begin with). */}
        <div className="flex items-center justify-between rounded-md border border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium">This company</p>
            <p className="text-caption">{member.membership.department || 'No department set'}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="info">{RoleLabels[member.membership.role]}</Badge>
            <StatusBadge domain="membership" status={member.membership.status} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityTab({ companyId, userId }: { companyId: string; userId: string }) {
  const { data, loading, error } = useAsyncData(`team-activity-${companyId}-${userId}`, () => auditLogService.listCompanyEntries(companyId, null, 50));
  const entries = (data?.items ?? []).filter((e) => e.entityId === userId);

  if (error) return <ErrorState title="Couldn't load activity" description={error} />;
  if (loading) return <SkeletonTable rows={4} columns={3} />;
  if (entries.length === 0) {
    return <EmptyState title="No activity yet" description="Actions involving this team member will appear here." />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => {
        const { label, icon: Icon } = describeActivity(e);
        return (
          <li key={e.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm">
            <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
            <span className="flex-1">
              <span className="font-medium">{e.actorName}</span> {label}
            </span>
            <span className="text-caption shrink-0">{formatDateTime(e.timestamp)}</span>
          </li>
        );
      })}
    </ul>
  );
}
