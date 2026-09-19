import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { canAssignPlatformRole, PLATFORM_ROLES, type Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';

/**
 * Platform-level user/membership administration (Phase 26 - closes the "no dedicated platform
 * user management route exists yet" gap from ACCESS_CONTROL_IMPLEMENTATION_REPORT.md Section 17).
 *
 * Deliberately narrow in what it lists: this is the platform's own moderation queue (pending
 * registrations, rejected/suspended memberships, and anyone holding a platform-tier role), never
 * a directory of every active employee at every company. Platform staff have no legitimate reason
 * to browse an ordinary, already-approved company's roster through a platform-wide screen - that
 * remains each company's own `/api/companies/[companyId]/team` view, unchanged. This distinction
 * is what keeps "platform user management" from quietly becoming "PLATFORM_MANAGER can see
 * everyone in every company," which the brief's own PLATFORM_MANAGER restrictions forbid in
 * spirit even though membership rows aren't "company transactions" in the financial sense.
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

/** Suspend or reactivate an already-decided (non-pending) membership. Deliberately separate from
 *  decideRegistration - approving a registration and suspending a misbehaving account are
 *  different real-world actions, and conflating them into one "set any status" function would
 *  make it easy to accidentally let a suspend-caller also approve, or vice versa (they're gated
 *  on different permissions - see the route). */
export async function setMembershipStatus(
  userId: UUID,
  companyId: UUID,
  status: 'SUSPENDED' | 'ACTIVE',
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<{ userId: UUID; companyId: UUID; status: string }>> {
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
