'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, MoreHorizontal, Pencil, Plus, Search, Users } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useAuth, useWorkspace } from '@/hooks/useAuth';
import { companyService, type TeamMember, type InvitationSummary } from '@/services/company.service';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { BUYER_ROLES, RoleLabels, SUPPLIER_ROLES, type Role } from '@/config/rbac';
import { resizeImageToDataUrl } from '@/utils/image';
import { formatDate } from '@/utils/format';
import type { Department } from '@/types/company';

export default function TeamPage() {
  const company = useActiveCompany();
  const membership = useActiveMembership();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Team members</h1>
        <p className="text-body text-text-secondary">Who has access to {company?.name}&rsquo;s workspace.</p>
      </div>

      {/* Keyed by company id so switching companies remounts this (resetting state to its
          initial value naturally) instead of setState-ing a reset from inside an effect. */}
      {company && membership && (
        <TeamMemberSection key={company.id} companyId={company.id} callerRole={membership.role} />
      )}
    </div>
  );
}

function TeamMemberSection({ companyId, callerRole }: { companyId: string; callerRole: Role }) {
  const { session } = useAuth();
  const { data: members, error: loadError, reload } = useAsyncData<TeamMember[]>(companyId, () =>
    companyService.listTeamMembers(companyId, callerRole),
  );
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [invitationsRefreshKey, setInvitationsRefreshKey] = useState(0);
  const workspace = useWorkspace();
  const assignableRoles = workspace === 'supplier' ? SUPPLIER_ROLES : BUYER_ROLES;

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    return members.filter(({ membership, user }) => {
      if (roleFilter !== 'all' && membership.role !== roleFilter) return false;
      if (statusFilter !== 'all' && membership.status !== statusFilter) return false;
      if (q && !user.name.toLowerCase().includes(q) && !user.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, search, roleFilter, statusFilter]);

  if (loadError) {
    return (
      <ErrorState
        title="You don't have access to this page"
        description="Viewing team members requires the users.manage permission - ask a company owner or administrator."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AddTeamMemberForm companyId={companyId} onAdded={() => setInvitationsRefreshKey((k) => k + 1)} />

      <PendingInvitationsSection companyId={companyId} refreshKey={invitationsRefreshKey} />

      {members && members.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 sm:max-w-xs">
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leadingIcon={<Search className="h-4 w-4" aria-hidden="true" />}
            />
          </div>
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="sm:w-44">
            <option value="all">All roles</option>
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {RoleLabels[r]}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-40">
            <option value="all">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active users</CardTitle>
        </CardHeader>
        {members === null ? (
          <div className="p-5">
            <SkeletonText lines={4} />
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title="No team members" description="Invite colleagues to this company." className="border-0" />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title="No users match" description="Try a different search or filter." className="border-0" />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map(({ membership, user }) =>
              editingUserId === user.id ? (
                <li key={membership.id} className="px-5 py-4">
                  <EditTeamMemberForm
                    companyId={companyId}
                    callerRole={callerRole}
                    member={{ membership, user }}
                    onDone={() => {
                      setEditingUserId(null);
                      reload();
                    }}
                    onCancel={() => setEditingUserId(null)}
                  />
                </li>
              ) : (
                <MemberRow
                  key={membership.id}
                  companyId={companyId}
                  member={{ membership, user }}
                  isSelf={user.id === session?.user.id}
                  onEdit={() => setEditingUserId(user.id)}
                  onChanged={reload}
                />
              ),
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MemberRow({
  companyId,
  member,
  isSelf,
  onEdit,
  onChanged,
}: {
  companyId: string;
  member: TeamMember;
  isSelf: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { membership, user } = member;
  const toast = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState<'suspend' | 'activate' | 'offboard' | null>(null);
  const [resetResult, setResetResult] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleConfirm() {
    if (!confirming) return;
    const result =
      confirming === 'suspend'
        ? await companyService.suspendTeamMember(companyId, user.id)
        : confirming === 'activate'
          ? await companyService.activateTeamMember(companyId, user.id)
          : await companyService.offboardTeamMember(companyId, user.id);
    setConfirming(null);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(
      confirming === 'suspend' ? `${user.name} suspended.` : confirming === 'activate' ? `${user.name} reactivated.` : `${user.name} offboarded.`,
      'success',
    );
    onChanged();
  }

  async function handleResetPassword() {
    const result = await companyService.requestTeamMemberPasswordReset(companyId, user.id);
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
    <li className="flex flex-col gap-3 px-5 py-3">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/team/${user.id}`} className="flex items-center gap-3 hover:opacity-80">
          <Avatar name={user.name} imageUrl={user.avatarUrl} />
          <div>
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-caption">{user.email}</p>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          {membership.department && <span className="hidden text-caption sm:inline">{membership.department}</span>}
          <Badge tone="info">{RoleLabels[membership.role]}</Badge>
          <StatusBadge domain="membership" status={membership.status} />
          <DropdownMenu
            trigger={
              <button type="button" aria-label={`Actions for ${user.name}`} className="text-text-tertiary hover:text-text-primary">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            }
          >
            <DropdownMenuItem onClick={() => router.push(`/team/${user.id}`)}>View</DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleResetPassword}>Reset password</DropdownMenuItem>
            {!isSelf && membership.status === 'ACTIVE' && (
              <DropdownMenuItem destructive onClick={() => setConfirming('suspend')}>
                Suspend
              </DropdownMenuItem>
            )}
            {!isSelf && membership.status !== 'ACTIVE' && (
              <DropdownMenuItem onClick={() => setConfirming('activate')}>Activate</DropdownMenuItem>
            )}
            {!isSelf && membership.status !== 'SUSPENDED' && (
              <DropdownMenuItem destructive onClick={() => setConfirming('offboard')}>
                Offboard
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        </div>
      </div>

      {resetResult && (
        <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm">
          <p className="font-medium text-warning">Password reset requested for {user.email} - share this link/token with them now.</p>
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

      <ConfirmationDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={handleConfirm}
        title={
          confirming === 'suspend' ? 'Suspend this user?' : confirming === 'activate' ? 'Activate this user?' : 'Offboard this user?'
        }
        description={
          confirming === 'suspend'
            ? `${user.name} will keep their account but lose access to this company's workspace until reactivated.`
            : confirming === 'activate'
              ? `${user.name} will regain their previous access to this company's workspace.`
              : `This will remove ${user.name}'s active access to this organization. Historical activity and records will be preserved.`
        }
        confirmLabel={confirming === 'suspend' ? 'Suspend user' : confirming === 'activate' ? 'Activate user' : 'Offboard user'}
        destructive={confirming === 'suspend' || confirming === 'offboard'}
      />
    </li>
  );
}

/** A real dropdown of the company's own declared departments (Settings > Company > Departments -
 *  companyService.listDepartments), not a blank free-text box - CompanyMembership.department is
 *  still just a plain string (no FK to the Department table; see that model's own history), so
 *  this only changes what's offered to pick from, not the shape of what gets saved. The current
 *  value is always kept selectable even if it's since been removed from the company's own list
 *  (an old/legacy department name), so editing a member never silently drops what they already
 *  had set. */
export function DepartmentSelect({
  id,
  companyId,
  value,
  onChange,
}: {
  id: string;
  companyId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data: departments } = useAsyncData<Department[]>(companyId, () => companyService.listDepartments(companyId));
  const names = [...new Set([...(departments ?? []).map((d) => d.name), ...(value ? [value] : [])])];

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-text-primary">
        Department
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <option value="">No department</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Add User now creates a real invitation rather than an immediately-ACTIVE account (Real
 *  Company User Invitation + Onboarding phase) - addTeamMember() itself is untouched (still
 *  exported from company.service.ts for any other legitimate direct-creation caller), but the
 *  Team page's primary Add User action now calls inviteTeamMember() instead. This app still has
 *  no email delivery, so the generated invitation link is shown to the inviter exactly once,
 *  the same "copy and share out of band" pattern the old temporary-password banner used. */
function AddTeamMemberForm({ companyId, onAdded }: { companyId: string; onAdded: () => void }) {
  const workspace = useWorkspace();
  const assignableRoles = workspace === 'supplier' ? SUPPLIER_ROLES : BUYER_ROLES;

  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>(assignableRoles[assignableRoles.length - 1]);
  const [department, setDepartment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInvitation, setCreatedInvitation] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail('');
    setName('');
    setPhone('');
    setDepartment('');
    setRole(assignableRoles[assignableRoles.length - 1]);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await companyService.inviteTeamMember(companyId, {
      email: email.trim(),
      name: name.trim() || undefined,
      phone: phone.trim() || undefined,
      role,
      department: department.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCreatedInvitation({ email: result.data.invitation.email, link: invitationLink(result.data.token) });
    reset();
    setExpanded(false);
    onAdded();
  }

  async function copyLink() {
    if (!createdInvitation) return;
    await navigator.clipboard.writeText(createdInvitation.link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Add a team member</CardTitle>
        {!expanded && (
          <Button size="sm" onClick={() => setExpanded(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add user
          </Button>
        )}
      </CardHeader>

      {createdInvitation && (
        <CardContent className="border-t border-border">
          <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm">
            <p className="font-medium text-warning">Invitation created for {createdInvitation.email}.</p>
            <p className="text-warning">Email delivery is not configured - copy this link and share it with them.</p>
            <p className="text-warning">It won&rsquo;t be shown again after you leave this page.</p>
            <div className="flex items-center gap-2">
              <code className="overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs">{createdInvitation.link}</code>
              <Button size="sm" variant="outline" onClick={copyLink}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="w-fit" onClick={() => setCreatedInvitation(null)}>
              Dismiss
            </Button>
          </div>
        </CardContent>
      )}

      {expanded && (
        <CardContent className="flex flex-col gap-3 border-t border-border">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Work email"
              type="email"
              placeholder="colleague@company.example"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input label="Name" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Phone" placeholder="Optional" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div>
              <label htmlFor="team-member-role" className="mb-1 block text-sm font-medium text-text-primary">
                Role
              </label>
              <select
                id="team-member-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {RoleLabels[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DepartmentSelect id="team-member-department" companyId={companyId} value={department} onChange={setDepartment} />

          {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExpanded(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting} disabled={!email.trim()}>
              Send invitation
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function invitationLink(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/accept-invitation?token=${token}`;
}

/** Invitations this company has sent that haven't been accepted yet (Part 10) - a separate
 *  section from the active roster above, since an invitation has no CompanyMembership row at all
 *  until it's accepted (see invitation.service.ts's own comment on why). */
function PendingInvitationsSection({ companyId, refreshKey }: { companyId: string; refreshKey: number }) {
  const { data: invitations, error, reload } = useAsyncData<InvitationSummary[]>(`invitations-${companyId}-${refreshKey}`, () =>
    companyService.listPendingInvitations(companyId),
  );
  const toast = useToast();
  const [revoking, setRevoking] = useState<InvitationSummary | null>(null);
  const [linkPreview, setLinkPreview] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const pending = (invitations ?? []).filter((i) => i.status === 'PENDING' || i.status === 'EXPIRED');

  async function handleResend(invitation: InvitationSummary) {
    const result = await companyService.resendInvitation(companyId, invitation.id);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    setLinkPreview({ email: invitation.email, link: invitationLink(result.data.token) });
    toast.show(`Invitation resent to ${invitation.email}.`, 'success');
    reload();
  }

  async function handleRevoke() {
    if (!revoking) return;
    const result = await companyService.revokeInvitation(companyId, revoking.id);
    setRevoking(null);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(`Invitation to ${revoking.email} revoked.`, 'success');
    reload();
  }

  async function copyLink() {
    if (!linkPreview) return;
    await navigator.clipboard.writeText(linkPreview.link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (error) return null; // Same USERS_MANAGE permission as the roster above - never shown if that already failed.
  if (invitations === null) return <Skeleton className="h-24" />;
  if (pending.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {linkPreview && (
          <div className="m-4 flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm">
            <p className="font-medium text-warning">New invitation link for {linkPreview.email} - the previous link no longer works.</p>
            <div className="flex items-center gap-2">
              <code className="overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs">{linkPreview.link}</code>
              <Button size="sm" variant="outline" onClick={copyLink}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="w-fit" onClick={() => setLinkPreview(null)}>
              Dismiss
            </Button>
          </div>
        )}
        <ul className="divide-y divide-border">
          {pending.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-sm font-medium">{invitation.email}</p>
                <p className="text-caption">
                  {RoleLabels[invitation.role]} · Invited by {invitation.invitedByName} · {formatDate(invitation.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge domain="membership" status={invitation.status === 'EXPIRED' ? 'REJECTED' : 'PENDING_APPROVAL'} />
                <DropdownMenu
                  trigger={
                    <button type="button" aria-label={`Actions for invitation to ${invitation.email}`} className="text-text-tertiary hover:text-text-primary">
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </button>
                  }
                >
                  <DropdownMenuItem onClick={() => handleResend(invitation)}>Resend</DropdownMenuItem>
                  <DropdownMenuItem destructive onClick={() => setRevoking(invitation)}>
                    Revoke
                  </DropdownMenuItem>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      <ConfirmationDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={handleRevoke}
        title="Revoke invitation?"
        description="This invitation will no longer be usable."
        confirmLabel="Revoke invitation"
        destructive
      />
    </Card>
  );
}

export function EditTeamMemberForm({
  companyId,
  callerRole,
  member,
  onDone,
  onCancel,
}: {
  companyId: string;
  callerRole: Role;
  member: TeamMember;
  onDone: () => void;
  onCancel: () => void;
}) {
  const workspace = useWorkspace();
  const assignableRoles = workspace === 'supplier' ? SUPPLIER_ROLES : BUYER_ROLES;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(member.user.name);
  const [role, setRole] = useState<Role>(member.membership.role);
  const [department, setDepartment] = useState(member.membership.department ?? '');
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    try {
      setPendingAvatar(await resizeImageToDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process that image.');
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await companyService.updateTeamMember(
      companyId,
      member.user.id,
      {
        name: name.trim(),
        role,
        department: department.trim(),
        ...(pendingAvatar !== null ? { avatarUrl: pendingAvatar } : {}),
      },
      callerRole,
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Avatar name={name || member.user.name} imageUrl={pendingAvatar ?? member.user.avatarUrl} size="lg" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={`Change ${member.user.name}'s photo`}
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-text-secondary hover:text-text-primary"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
        </div>
        <p className="text-caption">{member.user.email}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <label htmlFor={`edit-role-${member.user.id}`} className="mb-1 block text-sm font-medium text-text-primary">
            Role
          </label>
          <select
            id={`edit-role-${member.user.id}`}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>
                {RoleLabels[r]}
              </option>
            ))}
          </select>
        </div>
        <DepartmentSelect id={`edit-department-${member.user.id}`} companyId={companyId} value={department} onChange={setDepartment} />
      </div>

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} loading={submitting} disabled={!name.trim()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
