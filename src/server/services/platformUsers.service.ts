import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { canAssignPlatformRole, PLATFORM_ROLES, type Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';

/**
 * Platform-level user/membership administration (Phase 26 - closes the "no dedicated platform
 * user management route exists yet" gap from ACCESS_CONTROL_IMPLEMENTATION_REPORT.md Section 17).
 *
 * `listPlatformUsers`/`decideRegistration`/`setMembershipStatus`/`changePlatformRole` below are
 * deliberately narrow in what they list: the platform's own moderation queue (pending
 * registrations, rejected/suspended memberships, and anyone holding a platform-tier role), never
 * a directory of every active employee at every company - see /admin/platform/users, which keeps
 * this exact narrow purpose unchanged.
 *
 * `listAllUsersForAdmin`/`getUserDetailForAdmin` (Platform Users Management follow-up) are a
 * deliberately broader, separate capability - a genuine "every registered user, every company"
 * directory for /admin/users. This is intentionally still gated on the same PLATFORM_USERS_MANAGE
 * permission the narrower queue already uses (not a new, wider-reaching permission) - both
 * screens answer "can this platform account administer people," just at different scopes, and
 * PLATFORM_MANAGER already legitimately holds that permission for the narrower queue today. All
 * mutations (suspend/activate, role change) continue to run through `setMembershipStatus`/
 * `changePlatformRole` above - the new directory is read-only aggregation, never a second
 * mutation path.
 */

export interface PlatformUserRow {
  userId: UUID;
  userName: string;
  userEmail: string;
  companyId: UUID;
  companyName: string;
  role: Role;
  status: string;
  joinedAt?: string;
  createdAt: string;
}

export async function listPlatformUsers(): Promise<ServiceResult<PlatformUserRow[]>> {
  const memberships = await db.companyMembership.findMany({
    where: {
      OR: [
        { status: { in: ['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'] } },
        { role: { in: [...PLATFORM_ROLES] } },
      ],
    },
    include: { user: true, company: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return ok(
    memberships.map((m) => ({
      userId: m.userId,
      userName: m.user.name,
      userEmail: m.user.email,
      companyId: m.companyId,
      companyName: m.company.name,
      role: m.role as Role,
      status: m.status,
      joinedAt: m.joinedAt?.toISOString(),
      createdAt: m.createdAt.toISOString(),
    })),
  );
}

/** Approve or reject a pending self-registration. Only ever transitions a genuinely
 *  PENDING_APPROVAL membership - conditional update, not read-then-write, so two concurrent
 *  decisions on the same registration can't both apply (the same pattern decideStep/acceptQuote
 *  already use for their own workflow-state races). */
export async function decideRegistration(
  userId: UUID,
  companyId: UUID,
  decision: 'APPROVED' | 'REJECTED',
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<{ userId: UUID; companyId: UUID; status: string }>> {
  const newStatus = decision === 'APPROVED' ? 'ACTIVE' : 'REJECTED';
  const { count } = await db.companyMembership.updateMany({
    where: { userId, companyId, status: 'PENDING_APPROVAL' },
    data: { status: newStatus, joinedAt: decision === 'APPROVED' ? new Date() : undefined },
  });
  if (count === 0) return fail('NOT_FOUND', 'No pending registration matches this user and company - it may already have been decided.');

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: `REGISTRATION_${newStatus === 'ACTIVE' ? 'APPROVED' : 'REJECTED'}`,
    entityType: 'CompanyMembership',
    entityId: userId,
    previousValue: { status: 'PENDING_APPROVAL' },
    newValue: { status: newStatus },
  });

  return ok({ userId, companyId, status: newStatus });
}

/** Platform-role seniority for the hierarchy guard below - higher number outranks lower. Legacy
 *  PLATFORM_ADMIN is kept permission-equivalent to PLATFORM_SUPER_ADMIN everywhere else in this
 *  app, so it ranks the same here too; PLATFORM_MANAGER is deliberately the only rung beneath
 *  them (this is the same three-role set PLATFORM_ROLES already enumerates - no new hierarchy
 *  invented, just an ordering over the existing one). */
const PLATFORM_ROLE_RANK: Partial<Record<Role, number>> = {
  PLATFORM_MANAGER: 0,
  PLATFORM_ADMIN: 1,
  PLATFORM_SUPER_ADMIN: 1,
};

/** Suspend or reactivate an already-decided (non-pending) membership. Deliberately separate from
 *  decideRegistration - approving a registration and suspending a misbehaving account are
 *  different real-world actions, and conflating them into one "set any status" function would
 *  make it easy to accidentally let a suspend-caller also approve, or vice versa (they're gated
 *  on different permissions - see the route).
 *
 *  Two guards mirror changePlatformRole's own, since PLATFORM_USERS_MANAGE (this function's own
 *  permission) is held by PLATFORM_MANAGER too, unlike PLATFORM_ROLES_MANAGE:
 *  1. actor.userId !== userId when suspending - a platform admin must never be able to lock
 *     themselves out with their own request (reactivating yourself, were you ever suspended by
 *     someone else, is harmless and stays allowed).
 *  2. A lower-ranked platform role may never suspend/activate a higher- or equally-ranked one -
 *     without this, PLATFORM_MANAGER (which holds PLATFORM_USERS_MANAGE) could suspend a
 *     PLATFORM_SUPER_ADMIN's own account, which the permission grant was never meant to allow. */
export async function setMembershipStatus(
  userId: UUID,
  companyId: UUID,
  status: 'SUSPENDED' | 'ACTIVE',
  actor: { userId: UUID; role: Role; name: string },
): Promise<ServiceResult<{ userId: UUID; companyId: UUID; status: string }>> {
  if (actor.userId === userId && status === 'SUSPENDED') {
    return fail('SELF_STATUS_CHANGE_DENIED', 'You cannot suspend your own account.');
  }

  const target = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (target && PLATFORM_ROLES.includes(target.role as Role)) {
    const actorRank = PLATFORM_ROLE_RANK[actor.role] ?? -1;
    const targetRank = PLATFORM_ROLE_RANK[target.role as Role] ?? -1;
    if (actorRank < targetRank) {
      return fail('FORBIDDEN', 'You cannot change the status of a higher-ranked platform account.');
    }
  }

  const fromStatus = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  const { count } = await db.companyMembership.updateMany({
    where: { userId, companyId, status: fromStatus },
    data: { status },
  });
  if (count === 0) {
    return fail('CONFLICT', `That membership isn't currently ${fromStatus === 'ACTIVE' ? 'active' : 'suspended'} - it may have already changed.`);
  }

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: status === 'ACTIVE' ? 'USER_ACTIVATED' : 'USER_SUSPENDED',
    entityType: 'CompanyMembership',
    entityId: userId,
    previousValue: { status: fromStatus },
    newValue: { status },
  });

  return ok({ userId, companyId, status });
}

/** Change someone's platform-tier role (PLATFORM_MANAGER <-> PLATFORM_SUPER_ADMIN). This is the
 *  one function in this file with real escalation stakes, so it re-derives every guard itself
 *  rather than trusting the route to have already checked them - defense in depth, the same
 *  reasoning ownsRecord's own comment gives for never trusting a single layer alone.
 *
 *  Guards, in order:
 *  1. The target company must actually be a platform-type company (not a real buyer/supplier) -
 *     this function must never be usable to grant a platform role inside an ordinary company.
 *  2. The new role must actually be a platform role - never a company-side role via this path.
 *  3. canAssignPlatformRole(actor.role) - only PLATFORM_SUPER_ADMIN (or the legacy
 *     PLATFORM_ADMIN) may grant a platform role at all. A PLATFORM_MANAGER calling this always
 *     fails here, regardless of what the route's own permission check already required -
 *     "Platform Manager cannot become Super Admin" and "cannot promote anyone else" both reduce
 *     to this one guard.
 *  4. actor.userId !== userId - no one may change their own platform role through this endpoint,
 *     mirroring updateTeamMember's own SELF_ROLE_CHANGE_DENIED for company roles exactly. */
export async function changePlatformRole(
  userId: UUID,
  companyId: UUID,
  newRole: Role,
  actor: { userId: UUID; role: Role; name: string },
): Promise<ServiceResult<{ userId: UUID; companyId: UUID; role: Role }>> {
  if (actor.userId === userId) {
    return fail('SELF_ROLE_CHANGE_DENIED', 'You cannot change your own platform role.');
  }
  if (!canAssignPlatformRole(actor.role)) {
    return fail('FORBIDDEN', 'Only a platform super admin can assign platform-tier roles.');
  }
  if (!PLATFORM_ROLES.includes(newRole)) {
    return fail('INVALID_ROLE', `${newRole} is not a platform role.`);
  }

  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company || company.isBuyer || company.isSupplier) {
    return fail('NOT_FOUND', 'That platform account could not be found.');
  }

  const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (!membership || !PLATFORM_ROLES.includes(membership.role as Role)) {
    return fail('NOT_FOUND', 'That platform account could not be found.');
  }

  const updated = await db.companyMembership.update({ where: { id: membership.id }, data: { role: newRole } });

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: 'PLATFORM_ROLE_CHANGED',
    entityType: 'CompanyMembership',
    entityId: userId,
    previousValue: { role: membership.role },
    newValue: { role: newRole },
  });

  return ok({ userId, companyId, role: updated.role as Role });
}

/** One row of the platform-wide user directory (/admin/users). A user can hold more than one
 *  `CompanyMembership` (multi-company access is a real, existing capability elsewhere in this
 *  app) - `primaryRole`/`primaryCompanyId`/`primaryCompanyName` reflect that user's *first*
 *  membership (earliest `createdAt`) and are meaningful ON THEIR OWN only when `membershipCount`
 *  and `distinctRoleCount` are both 1. The UI must check those counts before rendering the
 *  `primary*` fields as if they were the user's whole picture - showing "BUYER at Company A" for
 *  someone who is also "APPROVER at Company B" would misrepresent them as belonging to fewer
 *  companies/roles than they actually do. `distinctRoleCount` is separate from `membershipCount`
 *  because two memberships can share the same role (e.g. OWNER at two companies) - that case has
 *  more than one company but is still exactly one role, so it should never be presented as
 *  "multiple roles". The detail page's Access tab (`getUserDetailForAdmin`) remains the
 *  authoritative, complete view of every membership; this row is only ever a convenience summary
 *  for the list. */
export interface UserDirectoryRow {
  id: UUID;
  name: string;
  email: string;
  phone?: string;
  createdAt: string;
  membershipCount: number;
  distinctRoleCount: number;
  primaryRole?: Role;
  primaryStatus?: string;
  primaryCompanyId?: UUID;
  primaryCompanyName?: string;
}

export interface UserDirectoryFilters {
  search?: string;
  role?: Role;
  status?: string;
  companyId?: UUID;
  sort?: 'name' | 'email' | 'created';
}

/** Every registered user on the platform, regardless of company or role - deliberately the
 *  superset `listPlatformUsers` above is not (see this file's own top comment). Filtering by
 *  role/status/company matches ANY of a user's memberships, not just the "primary" one the row
 *  displays - a user with APPROVER at one company and BUYER at another must appear when filtering
 *  by either role, never be hidden just because their *first* membership happens to be the
 *  other one. */
export async function listAllUsersForAdmin(filters: UserDirectoryFilters = {}): Promise<ServiceResult<UserDirectoryRow[]>> {
  const users = await db.user.findMany({
    where: filters.search
      ? { OR: [{ name: { contains: filters.search, mode: 'insensitive' } }, { email: { contains: filters.search, mode: 'insensitive' } }] }
      : undefined,
    include: { memberships: { include: { company: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } } },
  });

  const filteredUsers = users.filter((u) => {
    if (filters.role && !u.memberships.some((m) => m.role === filters.role)) return false;
    if (filters.status && !u.memberships.some((m) => m.status === filters.status)) return false;
    if (filters.companyId && !u.memberships.some((m) => m.companyId === filters.companyId)) return false;
    return true;
  });

  const rows: UserDirectoryRow[] = filteredUsers.map((u) => {
    const primary = u.memberships[0];
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone ?? undefined,
      createdAt: u.createdAt.toISOString(),
      membershipCount: u.memberships.length,
      distinctRoleCount: new Set(u.memberships.map((m) => m.role)).size,
      primaryRole: primary?.role as Role | undefined,
      primaryStatus: primary?.status,
      primaryCompanyId: primary?.companyId,
      primaryCompanyName: primary?.company.name,
    };
  });

  rows.sort((a, b) => {
    if (filters.sort === 'name') return a.name.localeCompare(b.name);
    if (filters.sort === 'email') return a.email.localeCompare(b.email);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return ok(rows);
}

export interface UserMembershipDetail {
  companyId: UUID;
  companyName: string;
  isSupplier: boolean;
  isPlatform: boolean;
  role: Role;
  status: string;
  department?: string;
  invitedAt?: string;
  joinedAt?: string;
}

export interface UserDetail {
  id: UUID;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  createdAt: string;
  memberships: UserMembershipDetail[];
}

/** The full, authoritative picture of one user for the User Detail page - every membership
 *  (platform, buyer-company, and supplier alike) they hold, never just the "primary" one the
 *  directory row summarizes. Never selects `passwordHash` or anything session/credential-shaped -
 *  the User Prisma model's own fields already exclude everything else sensitive by construction
 *  (see that model's own doc comment). */
export async function getUserDetailForAdmin(userId: UUID): Promise<ServiceResult<UserDetail>> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      createdAt: true,
      memberships: {
        include: { company: { select: { id: true, name: true, isBuyer: true, isSupplier: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!user) return fail('NOT_FOUND', 'That user could not be found.');

  return ok({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    avatarUrl: user.avatarUrl ?? undefined,
    createdAt: user.createdAt.toISOString(),
    memberships: user.memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      isSupplier: m.company.isSupplier,
      isPlatform: !m.company.isBuyer && !m.company.isSupplier,
      role: m.role as Role,
      status: m.status,
      department: m.department ?? undefined,
      invitedAt: m.invitedAt?.toISOString(),
      joinedAt: m.joinedAt?.toISOString(),
    })),
  });
}
