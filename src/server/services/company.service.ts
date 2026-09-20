import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import type { ServiceResult, UUID } from '@/types/common';
import type { Branch, Company, CompanyUser, CostCenter, Department, User } from '@/types/company';
import { BUYER_ROLES, SUPPLIER_ROLES, type Role } from '@/config/rbac';
import { toBranchDto, toCompanyDto, toCostCenterDto, toDepartmentDto, toMembershipDto, toUserDto } from '@/server/dto/company';

/**
 * The real, database-backed counterpart to src/services/company.service.ts's mock - same method
 * shapes, same validation rules, now against Postgres instead of localStorage. Route handlers
 * under app/api/companies/[companyId]/* call these after requireCompanyAccess() has already
 * checked authentication/authorization; this layer only ever re-validates business rules
 * (non-empty names, non-negative amounts, ...), never auth - that's the point of a Route → auth
 * → service → repository stack (section 3): each layer does exactly one job.
 */

export interface CompanyProfilePatch {
  name?: string;
  legalName?: string;
  registrationNumber?: string;
  taxId?: string;
  industry?: string;
  website?: string;
  phone?: string;
  email?: string;
  description?: string;
}

/** One row of the platform-wide company directory (Phase 26 follow-up - closes the
 *  "/admin/companies reads from a frontend-only localStorage mock" gap). Deliberately narrow:
 *  exactly the fields the Companies page displays, never credit limit/available (real financial
 *  figures), tax id, registration number, email, or anything else that isn't already shown
 *  there - "a directory," not "every company's full profile." */
export interface PlatformCompanyRow {
  id: UUID;
  name: string;
  country: string;
  currency: string;
  creditTerms: string;
  memberCount: number;
  createdAt: string;
}

/** Every real buyer company on the platform (Phase 26 follow-up) - gated by the route to
 *  `PLATFORM_TRANSACTIONS_ACCESS` (PLATFORM_SUPER_ADMIN/legacy PLATFORM_ADMIN only), the same
 *  permission every other cross-company business-data listing already requires
 *  (`/api/orders`, `/api/payments`, `/api/disputes`, `/api/analytics`) - a full company roster is
 *  exactly the kind of "another company's business data" that permission exists to gate, even
 *  though no single order/invoice/payment is involved. `isBuyer: true` excludes both supplier
 *  companies and platform-type companies (Platform Headquarters included) - this is a directory
 *  of the platform's actual customers, not every row in the Company table. */
export async function listAllCompanies(): Promise<ServiceResult<PlatformCompanyRow[]>> {
  const companies = await db.company.findMany({
    where: { isBuyer: true },
    select: {
      id: true,
      name: true,
      country: true,
      currency: true,
      creditTerms: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return ok(
    companies.map((c) => ({
      id: c.id,
      name: c.name,
      country: c.country,
      currency: c.currency,
      creditTerms: c.creditTerms,
      memberCount: c._count.memberships,
      createdAt: c.createdAt.toISOString(),
    })),
  );
}

export async function getCompanyProfile(companyId: UUID): Promise<ServiceResult<Company>> {
  const company = await db.company.findUnique({ where: { id: companyId }, include: { addresses: true, parentGroup: true } });
  if (!company) return fail('NOT_FOUND', 'That company could not be found.');
  return ok(toCompanyDto(company));
}

export async function updateCompanyProfile(companyId: UUID, patch: CompanyProfilePatch): Promise<ServiceResult<Company>> {
  const company = await db.company.update({ where: { id: companyId }, data: patch, include: { addresses: true, parentGroup: true } });
  return ok(toCompanyDto(company));
}

export interface TeamMember {
  membership: CompanyUser;
  user: User;
}

export async function listTeamMembers(companyId: UUID): Promise<ServiceResult<TeamMember[]>> {
  const memberships = await db.companyMembership.findMany({ where: { companyId }, include: { user: true } });
  return ok(memberships.map((m) => ({ membership: toMembershipDto(m), user: toUserDto(m.user) })));
}

export interface NewTeamMemberInput {
  email: string;
  /** Only required when no account exists yet for `email` - ignored otherwise (an existing
   *  account's name is its own). */
  name?: string;
  role: Role;
  department?: string;
}

export interface AddedTeamMember extends TeamMember {
  /** Set only when a brand-new account was created for this email - see
   *  server/auth/password.ts's generateTemporaryPassword for why: this app has no email
   *  delivery, so the caller shows this once for the admin to share with the new member
   *  themselves. Undefined when an existing account was just given a new membership - they
   *  already have their own password and don't need a new one. */
  temporaryPassword?: string;
}

/** Adds someone to this company - either a brand-new account (created here, with a generated
 *  temporary password) or an existing one (just a new CompanyMembership row; this is exactly
 *  how a person like the seeded John Doe ends up belonging to several companies at once, see
 *  DEMO_ACCOUNTS.md). Either way the new membership is ACTIVE immediately, not a pending
 *  "invited, must accept" state - there's no accept-an-invite flow for it to be pending on, and
 *  an admin adding someone here is already vouching for them having real access now. */
export async function addTeamMember(
  companyId: UUID,
  input: NewTeamMemberInput,
  actor: { userId: UUID; role: Role },
): Promise<ServiceResult<AddedTeamMember>> {
  const email = input.email.trim().toLowerCase();
  if (!email) return fail('EMPTY', 'Enter an email address.');

  // Never trust the caller's chosen role at face value - it must be one this company can
  // actually grant. Without this check, USERS_MANAGE at any ordinary buyer or supplier company
  // would double as a path to PLATFORM_ADMIN (a platform-wide role, not a company one) or to a
  // role belonging to the other side of the marketplace entirely (a buyer company handing out
  // SUPPLIER_ADMIN, or vice versa).
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return fail('NOT_FOUND', 'That company could not be found.');
  const allowedRoles = company.isSupplier ? SUPPLIER_ROLES : BUYER_ROLES;
  if (!allowedRoles.includes(input.role)) {
    return fail('INVALID_ROLE', `${input.role} is not a role this company can grant.`);
  }
  // Role-escalation protection (section 24) - USERS_MANAGE is held by both OWNER and ADMIN
  // (they're permission-equivalent in rbac.ts), so without this, an ADMIN could hand out the
  // OWNER role freely. Only an existing OWNER may grant OWNER.
  if (input.role === 'OWNER' && actor.role !== 'OWNER') {
    return fail('OWNER_ROLE_RESTRICTED', 'Only an existing owner can grant the owner role.');
  }

  const existingUser = await db.user.findUnique({ where: { email } });

  if (existingUser) {
    const existingMembership = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId, userId: existingUser.id } },
    });
    if (existingMembership) return fail('ALREADY_MEMBER', 'This person already has access to this company.');

    const membership = await db.companyMembership.create({
      data: { companyId, userId: existingUser.id, role: input.role, department: input.department, status: 'ACTIVE', joinedAt: new Date() },
    });
    await recordTeamAudit(companyId, actor.userId, 'TEAM_MEMBER_ADDED', existingUser.id, { role: input.role });
    return ok({ membership: toMembershipDto(membership), user: toUserDto(existingUser) });
  }

  const name = input.name?.trim();
  if (!name) return fail('NAME_REQUIRED', "Enter this person's name - no account exists yet for this email.");

  const { hashPassword, generateTemporaryPassword } = await import('@/server/auth/password');
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const { user, membership } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email, passwordHash } });
    const membership = await tx.companyMembership.create({
      data: { companyId, userId: user.id, role: input.role, department: input.department, status: 'ACTIVE', joinedAt: new Date() },
    });
    return { user, membership };
  });

  await recordTeamAudit(companyId, actor.userId, 'TEAM_MEMBER_ADDED', user.id, { role: input.role });
  return ok({ membership: toMembershipDto(membership), user: toUserDto(user), temporaryPassword });
}

/** Shared audit-trail helper for team/membership changes (section 25/28) - never called for a
 *  read, only for the mutations that actually change who has access to a company. */
async function recordTeamAudit(companyId: UUID, actorId: UUID, action: string, targetUserId: UUID, newValue: unknown, previousValue?: unknown): Promise<void> {
  const { recordAudit } = await import('./audit.service');
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { name: true } });
  await recordAudit({
    actorId,
    actorName: actor?.name ?? 'Unknown',
    companyId,
    action,
    entityType: 'CompanyMembership',
    entityId: targetUserId,
    previousValue,
    newValue,
  });
}

export interface TeamMemberPatch {
  role?: Role;
  department?: string;
  /** Edits the person's own account fields, not just their membership here - useful for an
   *  admin correcting a name typo or setting a photo for someone who hasn't logged in yet to
   *  set one themselves. Empty string clears department/avatar; `undefined` leaves it as-is. */
  name?: string;
  avatarUrl?: string;
}

/** An admin editing an existing member's role/department, and optionally the underlying
 *  account's own name/avatar - the Team page's "Edit" action (company.service.ts's
 *  addTeamMember is "Add a team member"; this is the counterpart for someone already on the
 *  list). `userId` + `companyId` together are what's checked, exactly like every other
 *  company-scoped mutation in this file - never just a membership id, which on its own says
 *  nothing about which company it belongs to. */
export async function updateTeamMember(
  companyId: UUID,
  userId: UUID,
  patch: TeamMemberPatch,
  actor: { userId: UUID; role: Role },
): Promise<ServiceResult<TeamMember>> {
  const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId } }, include: { user: true } });
  if (!membership) return fail('NOT_FOUND', 'That team member could not be found.');

  if (patch.role) {
    // Role-escalation protection (section 24/25) - no one may change their own role through
    // this endpoint, promotion or otherwise; a separate owner/admin must do it. Without this, any
    // USERS_MANAGE holder (including ADMIN, permission-equivalent to OWNER in rbac.ts) could
    // promote themselves to OWNER with a single PATCH on their own userId.
    if (actor.userId === userId) {
      return fail('SELF_ROLE_CHANGE_DENIED', 'You cannot change your own role. Ask another owner or admin to do this.');
    }
    // Only an existing OWNER may grant or revoke the OWNER role itself.
    if ((patch.role === 'OWNER' || membership.role === 'OWNER') && actor.role !== 'OWNER') {
      return fail('OWNER_ROLE_RESTRICTED', 'Only an existing owner can grant or change the owner role.');
    }
    const company = await db.company.findUnique({ where: { id: companyId } });
    const allowedRoles = company?.isSupplier ? SUPPLIER_ROLES : BUYER_ROLES;
    if (!allowedRoles.includes(patch.role)) {
      return fail('INVALID_ROLE', `${patch.role} is not a role this company can grant.`);
    }
  }
  if (patch.name !== undefined && !patch.name.trim()) {
    return fail('EMPTY_NAME', "Enter this person's name.");
  }
  const { validateAvatarUrl } = await import('./user.service');
  const avatarError = validateAvatarUrl(patch.avatarUrl);
  if (avatarError) return avatarError;

  const [updatedMembership, updatedUser] = await db.$transaction([
    db.companyMembership.update({
      where: { id: membership.id },
      data: { role: patch.role, department: patch.department !== undefined ? patch.department.trim() || null : undefined },
    }),
    db.user.update({
      where: { id: userId },
      data: {
        name: patch.name?.trim(),
        avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl.trim() || null : undefined,
      },
    }),
  ]);

  if (patch.role && patch.role !== membership.role) {
    await recordTeamAudit(companyId, actor.userId, 'TEAM_MEMBER_ROLE_CHANGED', userId, { role: patch.role }, { role: membership.role });
  }

  return ok({ membership: toMembershipDto(updatedMembership), user: toUserDto(updatedUser) });
}

export async function listDepartments(companyId: UUID): Promise<ServiceResult<Department[]>> {
  const departments = await db.department.findMany({ where: { companyId } });
  return ok(departments.map(toDepartmentDto));
}

export async function createDepartment(companyId: UUID, name: string): Promise<ServiceResult<Department>> {
  if (!name.trim()) return fail('EMPTY', 'Give the department a name.');
  const department = await db.department.create({ data: { companyId, name: name.trim() } });
  return ok(toDepartmentDto(department));
}

export async function removeDepartment(companyId: UUID, departmentId: UUID): Promise<ServiceResult<void>> {
  const { count } = await db.department.deleteMany({ where: { id: departmentId, companyId } });
  if (count === 0) return fail('NOT_FOUND', 'That department could not be found.');
  return ok(undefined);
}

export async function listCostCenters(companyId: UUID): Promise<ServiceResult<CostCenter[]>> {
  const costCenters = await db.costCenter.findMany({ where: { companyId } });
  return ok(costCenters.map(toCostCenterDto));
}

export async function createCostCenter(
  companyId: UUID,
  code: string,
  name: string,
  departmentId: UUID | undefined,
): Promise<ServiceResult<CostCenter>> {
  if (!code.trim() || !name.trim()) return fail('EMPTY', 'Give the cost center a code and a name.');
  const existing = await db.costCenter.findFirst({ where: { companyId, code: code.trim() } });
  if (existing) return fail('DUPLICATE_CODE', 'A cost center with this code already exists.');
  const costCenter = await db.costCenter.create({ data: { companyId, code: code.trim(), name: name.trim(), departmentId } });
  return ok(toCostCenterDto(costCenter));
}

export async function removeCostCenter(companyId: UUID, costCenterId: UUID): Promise<ServiceResult<void>> {
  const { count } = await db.costCenter.deleteMany({ where: { id: costCenterId, companyId } });
  if (count === 0) return fail('NOT_FOUND', 'That cost center could not be found.');
  return ok(undefined);
}

export interface NewBranchInput {
  name: string;
  addressId: UUID;
  contactName?: string;
  contactPhone?: string;
  costCenterId?: UUID;
  isWarehouse: boolean;
}

export async function listBranches(companyId: UUID): Promise<ServiceResult<Branch[]>> {
  const branches = await db.branch.findMany({ where: { companyId } });
  return ok(branches.map(toBranchDto));
}

export async function createBranch(companyId: UUID, input: NewBranchInput): Promise<ServiceResult<Branch>> {
  if (!input.name.trim()) return fail('EMPTY', 'Give the branch a name.');
  const branch = await db.branch.create({
    data: {
      companyId,
      name: input.name.trim(),
      addressId: input.addressId,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      costCenterId: input.costCenterId,
      isWarehouse: input.isWarehouse,
    },
  });
  return ok(toBranchDto(branch));
}

export async function removeBranch(companyId: UUID, branchId: UUID): Promise<ServiceResult<void>> {
  const branch = await db.branch.findFirst({ where: { id: branchId, companyId } });
  if (!branch) return fail('NOT_FOUND', 'That branch could not be found.');
  if (branch.isHeadOffice) return fail('INVALID_STATE', 'The head office branch cannot be removed.');
  await db.branch.delete({ where: { id: branchId } });
  return ok(undefined);
}

// Spending limits (section 11.5, Phase 14 Stage 6) - a company's own override where one has been
// set (SpendingLimit table), the platform default (config/spending-limits.ts) otherwise. Moved
// together with procurement.service.ts's createPurchaseRequest, the thing that actually enforces
// this business rule, so the two can never desync the way they would have if only one had moved.

const BUYER_ROLES_FOR_LIMITS: Role[] = ['OWNER', 'ADMIN', 'PROCUREMENT_MANAGER', 'BUYER', 'FINANCE_MANAGER', 'APPROVER', 'EMPLOYEE'];

/** The effective spending limit for one role at one company - a company's own override if it has
 *  set one, otherwise the platform default, otherwise `undefined` (no limit). Exported so
 *  procurement.service.ts's createPurchaseRequest can enforce it. */
export async function getEffectiveSpendingLimit(companyId: UUID, role: Role): Promise<number | undefined> {
  const override = await db.spendingLimit.findUnique({ where: { companyId_role: { companyId, role } } });
  if (override) return Number(override.amount);
  const { DefaultSpendingLimits } = await import('@/config/spending-limits');
  return DefaultSpendingLimits[role];
}

export async function listSpendingLimits(companyId: UUID): Promise<ServiceResult<{ role: Role; amount: number | undefined }[]>> {
  const amounts = await Promise.all(BUYER_ROLES_FOR_LIMITS.map((role) => getEffectiveSpendingLimit(companyId, role)));
  return ok(BUYER_ROLES_FOR_LIMITS.map((role, i) => ({ role, amount: amounts[i] })));
}

export async function setSpendingLimit(companyId: UUID, role: Role, amount: number): Promise<ServiceResult<void>> {
  if (amount < 0) return fail('INVALID_AMOUNT', 'Set a spending limit of zero or more.');
  await db.spendingLimit.upsert({
    where: { companyId_role: { companyId, role } },
    update: { amount },
    create: { companyId, role, amount },
  });
  return ok(undefined);
}
