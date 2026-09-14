import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import type { ServiceResult, UUID } from '@/types/common';
import type { Branch, Company, CompanyUser, CostCenter, Department, User } from '@/types/company';
import type { Role } from '@/config/rbac';
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
