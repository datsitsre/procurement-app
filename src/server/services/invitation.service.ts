import 'server-only';
import { randomBytes, createHash } from 'crypto';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { hashPassword } from '@/server/auth/password';
import { recordAudit } from './audit.service';
import { BUYER_ROLES, SUPPLIER_ROLES, type Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';

/**
 * Real company (and platform - see this model's own schema comment) user invitation and
 * onboarding. Replaces addTeamMember's "create an ACTIVE account immediately, show a one-time
 * temporary password" default for the primary Add User flow - addTeamMember() itself is
 * untouched and still exported, for any caller that genuinely needs immediate creation, but the
 * /team page's Add User action now calls inviteTeamMember() instead.
 *
 * Same raw-token-in-the-link/only-a-hash-in-the-database pattern passwordReset.service.ts and
 * session.ts already use - a leaked database dump alone can never be replayed as a valid
 * invitation. Deliberately one row per invitation, mutated in place by resend (new token/expiry
 * overwrite the old ones) rather than accumulating a new row per resend - see resendInvitation's
 * own comment.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

/** The single place invitation validity is decided - a token is usable only while every one of
 *  "not yet accepted," "not revoked," and "not yet expired" holds (Part B8/Phase 8). */
function resolveInvitationStatus(invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }): InvitationStatus {
  if (invitation.acceptedAt) return 'ACCEPTED';
  if (invitation.revokedAt) return 'REVOKED';
  if (invitation.expiresAt < new Date()) return 'EXPIRED';
  return 'PENDING';
}

export interface InvitationSummary {
  id: UUID;
  email: string;
  role: Role;
  name?: string;
  department?: string;
  companyId: UUID;
  companyName: string;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  status: InvitationStatus;
}

function toSummary(row: {
  id: string;
  email: string;
  role: string;
  name: string | null;
  department: string | null;
  companyId: string;
  company: { name: string };
  invitedBy: { name: string };
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    name: row.name ?? undefined,
    department: row.department ?? undefined,
    companyId: row.companyId,
    companyName: row.company.name,
    invitedByName: row.invitedBy.name,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    status: resolveInvitationStatus(row),
  };
}

export interface NewInvitationInput {
  email: string;
  role: Role;
  name?: string;
  phone?: string;
  department?: string;
}

/** Creates one invitation - the shared primitive both the company Team page and the platform
 *  Add Platform User flow (Part X) call. Deliberately does NOT itself decide which roles the
 *  actor may grant - that policy differs between the two callers (company role hierarchy vs
 *  platform role hierarchy), so each caller (inviteTeamMember / invitePlatformUser below) checks
 *  its own rules before calling this, the same "defense in depth at the specific call site"
 *  pattern changePlatformRole already established. Returns the raw token exactly once - nothing
 *  after this call can ever retrieve it again. */
async function createInvitation(
  companyId: UUID,
  input: NewInvitationInput,
  actor: { userId: UUID; name: string },
  auditAction: 'TEAM_MEMBER_INVITED' | 'PLATFORM_USER_INVITED' = 'TEAM_MEMBER_INVITED',
): Promise<ServiceResult<{ invitation: InvitationSummary; token: string }>> {
  const email = input.email.trim().toLowerCase();
  if (!email) return fail('EMPTY', 'Enter an email address.');

  const existingMembership = await db.companyMembership.findFirst({
    where: { companyId, user: { email } },
  });
  if (existingMembership) return fail('ALREADY_MEMBER', 'This person already has access to this company.');

  const existingInvitation = await db.companyInvitation.findFirst({
    where: { companyId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (existingInvitation) {
    return fail('INVITATION_ALREADY_PENDING', 'This person already has a pending invitation - resend it instead of creating a new one.');
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const created = await db.companyInvitation.create({
    data: {
      companyId,
      email,
      role: input.role,
      name: input.name?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      department: input.department?.trim() || undefined,
      invitedById: actor.userId,
      tokenHash: hashToken(token),
      expiresAt,
    },
    include: { company: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });

  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: auditAction,
    entityType: 'CompanyInvitation',
    entityId: created.id,
    newValue: { email, role: input.role },
  });

  return ok({ invitation: toSummary(created), token });
}

/** Invites someone to the caller's own company (Part 4/5/6) - role-assignability rules mirror
 *  addTeamMember's exactly (never a platform role via this path; OWNER only grantable by an
 *  existing OWNER), since inviting someone is the same governance decision as adding them
 *  directly, just deferred until they accept. */
export async function inviteTeamMember(
  companyId: UUID,
  input: NewInvitationInput,
  actor: { userId: UUID; name: string; role: Role },
): Promise<ServiceResult<{ invitation: InvitationSummary; token: string }>> {
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return fail('NOT_FOUND', 'That company could not be found.');

  const allowedRoles = company.isSupplier ? SUPPLIER_ROLES : BUYER_ROLES;
  if (!allowedRoles.includes(input.role)) {
    return fail('INVALID_ROLE', `${input.role} is not a role this company can grant.`);
  }
  if (input.role === 'OWNER' && actor.role !== 'OWNER') {
    return fail('OWNER_ROLE_RESTRICTED', 'Only an existing owner can invite someone as owner.');
  }

  return createInvitation(companyId, input, actor);
}

/** Invites the first administrator of a brand-new company (Super Admin Add Company wizard).
 *  Deliberately does NOT go through `inviteTeamMember` above - that function's own
 *  `OWNER_ROLE_RESTRICTED` guard ("only an existing owner can invite someone as owner") is
 *  exactly correct for an established company, but would incorrectly block this exact case: a
 *  brand-new company has zero members, so there is no existing owner to authorize the first one
 *  - the platform admin's own `PLATFORM_COMPANIES_CREATE` permission (already checked by the
 *  route before this is ever called) is the authorization for this one-time act instead. Only
 *  ever OWNER or ADMIN - never a platform or supplier role, and never any other buyer role -
 *  since this person is meant to run the company, not just work in it. */
export async function inviteInitialCompanyAdministrator(
  companyId: UUID,
  input: { email: string; name: string; phone?: string; role: 'OWNER' | 'ADMIN' },
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<{ invitation: InvitationSummary; token: string }>> {
  if (input.role !== 'OWNER' && input.role !== 'ADMIN') {
    return fail('INVALID_ROLE', 'The initial administrator must be an OWNER or ADMIN.');
  }

  return createInvitation(companyId, { email: input.email, name: input.name, phone: input.phone, role: input.role }, actor, 'TEAM_MEMBER_INVITED');
}

/** Invites someone to a platform-tier role (Part X) - the "company" here is always the caller's
 *  own platform-type Company row (Platform Headquarters), resolved from their session, never a
 *  client-supplied id. Reuses this file's own createInvitation rather than a second invitation
 *  model, since a "platform user" is exactly a CompanyMembership at that company with a
 *  PLATFORM_* role - nothing else differs. */
export async function invitePlatformUser(
  platformCompanyId: UUID,
  input: { email: string; name: string; role: Role },
  actor: { userId: UUID; name: string; role: Role },
): Promise<ServiceResult<{ invitation: InvitationSummary; token: string }>> {
  const { Role: RoleEnum, PLATFORM_ROLES, canAssignPlatformRole } = await import('@/config/rbac');
  if (!canAssignPlatformRole(actor.role)) {
    return fail('FORBIDDEN', 'Only a platform super admin can create platform accounts.');
  }
  if (!PLATFORM_ROLES.includes(input.role)) {
    return fail('INVALID_ROLE', `${input.role} is not a platform role.`);
  }
  // The legacy PLATFORM_ADMIN role is permission-equivalent to PLATFORM_SUPER_ADMIN everywhere
  // else in this app (including the existing changePlatformRole path), but this NEW invitation
  // capability draws a tighter line: only a genuine PLATFORM_SUPER_ADMIN may bring another
  // Super Admin onto the platform - a legacy Admin may only invite PLATFORM_MANAGER.
  if (input.role === RoleEnum.PLATFORM_SUPER_ADMIN && actor.role !== RoleEnum.PLATFORM_SUPER_ADMIN) {
    return fail('FORBIDDEN', 'Only a platform super admin can create another super admin.');
  }

  return createInvitation(platformCompanyId, { email: input.email, name: input.name, role: input.role }, actor, 'PLATFORM_USER_INVITED');
}

export async function listPendingInvitations(companyId: UUID): Promise<ServiceResult<InvitationSummary[]>> {
  const rows = await db.companyInvitation.findMany({
    where: { companyId, acceptedAt: null },
    include: { company: { select: { name: true } }, invitedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(rows.map(toSummary));
}

/** Regenerates an invitation's token/expiry in place (Part 12) - deliberately mutates the same
 *  row rather than creating a new one each time, so resending repeatedly can never accumulate
 *  unbounded invitation rows for one email. The previous token stops working immediately (its
 *  hash no longer matches anything in the row), satisfying "resend invalidates the previous
 *  token" without needing a separate revocation step. */
export async function resendInvitation(
  companyId: UUID,
  invitationId: UUID,
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<{ invitation: InvitationSummary; token: string }>> {
  const existing = await db.companyInvitation.findUnique({ where: { id: invitationId } });
  if (!existing || existing.companyId !== companyId) return fail('NOT_FOUND', 'That invitation could not be found.');
  const status = resolveInvitationStatus(existing);
  if (status !== 'PENDING' && status !== 'EXPIRED') {
    return fail('CONFLICT', 'This invitation has already been accepted or revoked.');
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const updated = await db.companyInvitation.update({
    where: { id: invitationId },
    data: { tokenHash: hashToken(token), expiresAt, revokedAt: null },
    include: { company: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });

  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: 'TEAM_MEMBER_INVITATION_RESENT',
    entityType: 'CompanyInvitation',
    entityId: invitationId,
    newValue: { expiresAt: expiresAt.toISOString() },
  });

  return ok({ invitation: toSummary(updated), token });
}

export async function revokeInvitation(
  companyId: UUID,
  invitationId: UUID,
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<InvitationSummary>> {
  const existing = await db.companyInvitation.findUnique({ where: { id: invitationId } });
  if (!existing || existing.companyId !== companyId) return fail('NOT_FOUND', 'That invitation could not be found.');
  const status = resolveInvitationStatus(existing);
  if (status === 'ACCEPTED') return fail('CONFLICT', 'This invitation has already been accepted.');
  if (status === 'REVOKED') return fail('CONFLICT', 'This invitation has already been revoked.');

  const updated = await db.companyInvitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
    include: { company: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });

  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: 'TEAM_MEMBER_INVITATION_REVOKED',
    entityType: 'CompanyInvitation',
    entityId: invitationId,
  });

  return ok(toSummary(updated));
}

export interface InvitationPreview {
  companyName: string;
  role: Role;
  email: string;
  name?: string;
  status: InvitationStatus;
  isExistingAccount: boolean;
}

/** A safe, pre-authentication preview for the public acceptance page - identified purely by
 *  token possession, the same trust model passwordReset.service.ts already uses. Never reveals
 *  whether a DIFFERENT email/company combination exists - only ever answers for the exact
 *  invitation this token hashes to (Part 8: "do not expose whether another company's user
 *  already exists"). */
export async function getInvitationPreview(token: string): Promise<ServiceResult<InvitationPreview>> {
  const invitation = await db.companyInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { company: { select: { name: true } } },
  });
  if (!invitation) return fail('INVALID_TOKEN', 'This invitation link is invalid.');

  const status = resolveInvitationStatus(invitation);
  if (status !== 'PENDING') {
    return fail(
      status === 'ACCEPTED' ? 'ALREADY_ACCEPTED' : status === 'REVOKED' ? 'REVOKED' : 'EXPIRED',
      status === 'ACCEPTED'
        ? 'This invitation has already been accepted.'
        : status === 'REVOKED'
          ? 'This invitation has been revoked.'
          : 'This invitation has expired - ask for a new one.',
    );
  }

  const existingUser = await db.user.findUnique({ where: { email: invitation.email }, select: { id: true } });

  return ok({
    companyName: invitation.company.name,
    role: invitation.role as Role,
    email: invitation.email,
    name: invitation.name ?? undefined,
    status,
    isExistingAccount: !!existingUser,
  });
}

export interface AcceptInvitationInput {
  token: string;
  /** Required only when no account exists yet for the invitation's email. */
  password?: string;
  /** Only used for a brand-new account, when the invitation itself carried no name. */
  name?: string;
}

/** Accepts an invitation transactionally (Part 6/7/14) - creates the User (brand-new email) or
 *  reuses the existing one (their password is never read or touched here), then creates the
 *  CompanyMembership as ACTIVE at the invitation's role, then marks the invitation accepted -
 *  all in one `$transaction`, so a failure partway through can never leave a User with no
 *  membership or an invitation marked accepted with nothing actually granted. Every other
 *  company membership this person already holds (Part 18) is never read or touched - this only
 *  ever creates one new row, for one company. */
export async function acceptInvitation(input: AcceptInvitationInput): Promise<ServiceResult<{ userId: UUID; companyId: UUID }>> {
  const invitation = await db.companyInvitation.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!invitation) return fail('INVALID_TOKEN', 'This invitation link is invalid.');

  const status = resolveInvitationStatus(invitation);
  if (status !== 'PENDING') {
    return fail(
      status === 'ACCEPTED' ? 'ALREADY_ACCEPTED' : status === 'REVOKED' ? 'REVOKED' : 'EXPIRED',
      status === 'ACCEPTED' ? 'This invitation has already been accepted.' : status === 'REVOKED' ? 'This invitation has been revoked.' : 'This invitation has expired - ask for a new one.',
    );
  }

  const existingUser = await db.user.findUnique({ where: { email: invitation.email } });

  // A concurrent acceptance, or the person having separately joined this exact company through
  // another path in the meantime - fail closed rather than silently overwrite their membership.
  if (existingUser) {
    const alreadyMember = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId: invitation.companyId, userId: existingUser.id } },
    });
    if (alreadyMember) return fail('ALREADY_MEMBER', 'This account already has access to this company.');
  }

  let passwordHash: string | undefined;
  let newAccountName: string | undefined;
  if (!existingUser) {
    if (!input.password || input.password.length < 8) {
      return fail('WEAK_PASSWORD', 'Choose a password with at least 8 characters.');
    }
    newAccountName = (input.name ?? invitation.name)?.trim();
    if (!newAccountName) return fail('NAME_REQUIRED', 'Enter your name.');
    passwordHash = await hashPassword(input.password);
  }

  let userId: UUID;
  try {
    userId = await db.$transaction(async (tx) => {
      const user = existingUser
        ? existingUser
        : await tx.user.create({
            data: { name: newAccountName!, email: invitation.email, passwordHash: passwordHash!, phone: invitation.phone ?? undefined },
          });

      await tx.companyMembership.create({
        data: {
          companyId: invitation.companyId,
          userId: user.id,
          role: invitation.role,
          department: invitation.department ?? undefined,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });

      // Conditional update, not read-then-write - the same workflow-state-race pattern used
      // throughout this codebase, so two concurrent accept attempts for the same invitation can
      // never both succeed.
      const { count } = await tx.companyInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedUserId: user.id },
      });
      if (count === 0) throw new Error('INVITATION_RACE');

      return user.id;
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVITATION_RACE') {
      return fail('ALREADY_ACCEPTED', 'This invitation has already been accepted.');
    }
    throw err;
  }

  await recordAudit({
    actorId: userId,
    actorName: existingUser?.name ?? newAccountName ?? invitation.email,
    companyId: invitation.companyId,
    action: 'TEAM_MEMBER_INVITATION_ACCEPTED',
    entityType: 'CompanyInvitation',
    entityId: invitation.id,
    newValue: { role: invitation.role },
  });

  return ok({ userId, companyId: invitation.companyId });
}
