'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { useAsyncData } from '@/hooks/useAsyncData';
import { platformUsersService, type UserDirectoryRow } from '@/services/platformUsers.service';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';

type SortKey = 'created' | 'name' | 'email';

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

/** Renders a user's role, but only as a single value when it genuinely is one - a user with
 *  memberships in more than one company can hold different roles at each (Company A + BUYER,
 *  Company B + APPROVER), and showing just the first membership's role would misrepresent them
 *  as exclusively that role. `distinctRoleCount` is checked instead of `membershipCount` because
 *  the same role at two companies (e.g. OWNER at both) is still genuinely one role - see
 *  UserDirectoryRow's own comment. Never invents a role name; "Multiple roles" is the only thing
 *  shown when there's more than one, and the detail page remains where the real list lives. */
function RoleCell({ u }: { u: UserDirectoryRow }) {
  if (!u.primaryRole) return <span>—</span>;
  if (u.distinctRoleCount <= 1) return <span>{ROLE_LABEL[u.primaryRole] ?? u.primaryRole}</span>;
  return (
    <Tooltip content={`Holds ${u.distinctRoleCount} different roles across their memberships - see the Access tab for the full list`}>
      <Badge tone="warning" tabIndex={0} className="w-fit cursor-default">
        Multiple roles
      </Badge>
    </Tooltip>
  );
}

/** Same reasoning as RoleCell - a user's `membershipCount` companies are never collapsed down to
 *  just the first one they joined. */
function CompanyCell({ u }: { u: UserDirectoryRow }) {
  if (u.membershipCount <= 1) return <span>{u.primaryCompanyName ?? '—'}</span>;
  return (
    <Tooltip content={`Belongs to ${u.membershipCount} companies - see the Access tab for the full list`}>
      <Badge tone="info" tabIndex={0} className="w-fit cursor-default">
        {u.membershipCount} Companies
      </Badge>
    </Tooltip>
  );
}

/**
 * The platform-wide user directory (Platform Users Management follow-up) - every registered
 * user across every company, with a link into a full detail page. Distinct from the narrower
 * moderation queue at /admin/platform/users (pending registrations, suspended/rejected accounts,
 * platform-tier roles only) - see platformUsers.service.ts's own top comment for why both exist.
 * GET /api/admin/users, PLATFORM_USERS_MANAGE. No delete - a user's membership status
 * (suspend/activate) is the only lifecycle lever, exactly like Companies/Suppliers.
 */
export default function AdminUsersPage() {
  return (
    <AdminGuard>
      <UsersDirectory />
    </AdminGuard>
  );
}

function UsersDirectory() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortKey>('created');
  const { data: users, loading, error, reload } = useAsyncData<UserDirectoryRow[]>(
    `admin-users-${search}-${status}-${sort}`,
    () => platformUsersService.listAllUsers({ search: search || undefined, status: status === 'all' ? undefined : status, sort }),
  );

  const rows = useMemo(() => users ?? [], [users]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Users</h1>
        <p className="text-body text-text-secondary">Every registered user across every company and organization.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 sm:max-w-xs">
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leadingIcon={<Search className="h-4 w-4" aria-hidden="true" />}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44">
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="INVITED">Invited</option>
          <option value="REJECTED">Rejected</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sm:w-40">
          <option value="created">Newest first</option>
          <option value="name">Name (A-Z)</option>
          <option value="email">Email (A-Z)</option>
        </Select>
      </div>

      {error ? (
        <ErrorState title="Couldn't load users" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : loading ? (
        <SkeletonTable rows={6} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="No users match" description="Try a different search or filter." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-table">
              <thead>
                <tr className="text-metadata">
                  <th className="p-4 text-left">User</th>
                  <th className="p-4 text-left">Role</th>
                  <th className="p-4 text-left">Company</th>
                  <th className="p-4 text-left">Status</th>
                  <th className="p-4 text-left">Joined</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} size="sm" />
                        <div>
                          <p className="font-medium">{u.name}</p>
                          <p className="text-caption">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <RoleCell u={u} />
                    </td>
                    <td className="p-4 text-text-secondary">
                      <CompanyCell u={u} />
                    </td>
                    <td className="p-4">{u.primaryStatus ? <StatusBadge domain="membership" status={u.primaryStatus} /> : <Badge tone="neutral">No membership</Badge>}</td>
                    <td className="p-4 text-text-secondary">{formatDate(u.createdAt)}</td>
                    <td className="p-4 text-right">
                      <Link href={`/admin/users/${u.id}`}>
                        <Button variant="outline" size="sm">
                          View
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {rows.map((u) => (
              <div key={u.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={u.name} size="sm" />
                    <div>
                      <p className="text-sm font-semibold">{u.name}</p>
                      <p className="text-caption">{u.email}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption">
                        <RoleCell u={u} />
                        <span>·</span>
                        <CompanyCell u={u} />
                      </div>
                      {u.primaryStatus && <StatusBadge domain="membership" status={u.primaryStatus} className="mt-1" />}
                    </div>
                  </div>
                  <Link href={`/admin/users/${u.id}`}>
                    <Button variant="outline" size="sm">
                      View
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
