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

export async function getCompanyProfile(companyId: UUID): Promise<ServiceResult<Company>> {
  const company = await db.company.findUnique({ where: { id: companyId }, include: { addresses: true } });
  if (!company) return fail('NOT_FOUND', 'That company could not be found.');
  return ok(toCompanyDto(company));
}

export async function updateCompanyProfile(companyId: UUID, patch: CompanyProfilePatch): Promise<ServiceResult<Company>> {
  const company = await db.company.update({ where: { id: companyId }, data: patch, include: { addresses: true } });
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
export async function addTeamMember(companyId: UUID, input: NewTeamMemberInput): Promise<ServiceResult<AddedTeamMember>> {
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

  const existingUser = await db.user.findUnique({ where: { email } });

  if (existingUser) {
    const existingMembership = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId, userId: existingUser.id } },
    });
    if (existingMembership) return fail('ALREADY_MEMBER', 'This person already has access to this company.');

    const membership = await db.companyMembership.create({
      data: { companyId, userId: existingUser.id, role: input.role, department: input.department, status: 'ACTIVE', joinedAt: new Date() },
    });
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

  return ok({ membership: toMembershipDto(membership), user: toUserDto(user), temporaryPassword });
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
