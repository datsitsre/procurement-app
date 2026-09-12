'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useActiveCompany, useActiveMembership } from '@/hooks/useAuth';
import { companyService, type TeamMember } from '@/services/company.service';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { RoleLabels, type Role } from '@/config/rbac';

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
        <TeamMemberList key={company.id} companyId={company.id} callerRole={membership.role} />
      )}
    </div>
  );
}

function TeamMemberList({ companyId, callerRole }: { companyId: string; callerRole: Role }) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    companyService.listTeamMembers(companyId, callerRole).then((result) => {
      if (result.ok) {
        setMembers(result.data);
      } else {
        setForbidden(true);
      }
    });
  }, [companyId, callerRole]);

  if (forbidden) {
    return (
      <ErrorState
        title="You don't have access to this page"
        description="Viewing team members requires the users.manage permission - ask a company owner or administrator."
      />
    );
  }

  return (
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
  );
}
