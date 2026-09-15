'use client';

import { useState } from 'react';
import { Check, Copy, Plus, Users } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { companyService, type TeamMember } from '@/services/company.service';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { BUYER_ROLES, RoleLabels, SUPPLIER_ROLES, type Role } from '@/config/rbac';

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
  const { data: members, error: loadError, reload } = useAsyncData<TeamMember[]>(companyId, () =>
    companyService.listTeamMembers(companyId, callerRole),
  );

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
      <AddTeamMemberForm companyId={companyId} callerRole={callerRole} onAdded={reload} />

      <Card>
        {members === null ? (
          <div className="p-5">
            <SkeletonText lines={4} />
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title="No team members" description="Invite colleagues to this company." className="border-0" />
        ) : (
          <ul className="divide-y divide-border">
            {members.map(({ membership, user }) => (
              <li key={membership.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={user.name} imageUrl={user.avatarUrl} />
                  <div>
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-caption">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {membership.department && <span className="text-caption">{membership.department}</span>}
                  <Badge tone="info">{RoleLabels[membership.role]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AddTeamMemberForm({ companyId, callerRole, onAdded }: { companyId: string; callerRole: Role; onAdded: () => void }) {
  const workspace = useWorkspace();
  const assignableRoles = workspace === 'supplier' ? SUPPLIER_ROLES : BUYER_ROLES;

  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(assignableRoles[assignableRoles.length - 1]);
  const [department, setDepartment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once, right after a brand-new account is created for this email - see
  // company.service.ts's addTeamMember for why this can't be retrieved again afterward.
  const [temporaryPassword, setTemporaryPassword] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail('');
    setName('');
    setDepartment('');
    setRole(assignableRoles[assignableRoles.length - 1]);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await companyService.addTeamMember(
      companyId,
      { email: email.trim(), name: name.trim() || undefined, role, department: department.trim() || undefined },
      callerRole,
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data.temporaryPassword) {
      setTemporaryPassword({ email: result.data.user.email, password: result.data.temporaryPassword });
    }
    reset();
    setExpanded(false);
    onAdded();
  }

  async function copyPassword() {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword.password).catch(() => undefined);
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

      {temporaryPassword && (
        <CardContent className="border-t border-border">
          <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm">
            <p className="font-medium text-warning">
              Account created for {temporaryPassword.email} - share this temporary password with them now.
            </p>
            <p className="text-warning">It won&rsquo;t be shown again after you leave this page.</p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-surface px-2 py-1 font-mono text-sm">{temporaryPassword.password}</code>
              <Button size="sm" variant="outline" onClick={copyPassword}>
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="w-fit" onClick={() => setTemporaryPassword(null)}>
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
            <Input
              label="Name (only needed for a brand-new account)"
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
            <Input label="Department (optional)" placeholder="e.g. Sales" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </div>

          {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExpanded(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting} disabled={!email.trim()}>
              Add to team
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
