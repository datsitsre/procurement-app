import { assertPermission, delay, fail, ok, ownsRecord } from './base';
import { allCompanies, allCompanyUsers, allUsers, writeCompanyProfileOverride } from './auth.service';
import { demoDepartments, demoCostCenters, demoBranches } from '@/lib/demo-data/company-workspace';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Branch, Company, CompanyUser, CostCenter, Department, User } from '@/types/company';
import { Permission, type Role } from '@/config/rbac';

export interface TeamMember {
  membership: CompanyUser;
  user: User;
}

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

const DEPARTMENT_STORE_KEY = 'procurement.departments.v1.list';
const COST_CENTER_STORE_KEY = 'procurement.cost-centers.v1.list';
const BRANCH_STORE_KEY = 'procurement.branches.v1.list';
const REMOVED_KEY = 'procurement.company-workspace.v1.removed';

function readList<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function appendToList<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  const list = readList<T>(key);
  list.push(value);
  window.localStorage.setItem(key, JSON.stringify(list));
}

/** A single "removed ids" set shared across departments/cost centers/branches - simpler than a
 *  separate removed-list per entity type, and every id in this app is already globally unique. */
function readRemoved(): Set<UUID> {
  return new Set(readList<UUID>(REMOVED_KEY));
}

function markRemoved(id: UUID) {
  if (typeof window === 'undefined') return;
  const removed = readRemoved();
  removed.add(id);
  window.localStorage.setItem(REMOVED_KEY, JSON.stringify(Array.from(removed)));
}

function allDepartments(): Department[] {
  const removed = readRemoved();
  return [...demoDepartments, ...readList<Department>(DEPARTMENT_STORE_KEY)].filter((d) => !removed.has(d.id));
}

function allCostCenters(): CostCenter[] {
  const removed = readRemoved();
  return [...demoCostCenters, ...readList<CostCenter>(COST_CENTER_STORE_KEY)].filter((c) => !removed.has(c.id));
}

function allBranches(): Branch[] {
  const removed = readRemoved();
  return [...demoBranches, ...readList<Branch>(BRANCH_STORE_KEY)].filter((b) => !removed.has(b.id));
}

export interface NewBranchInput {
  companyId: UUID;
  name: string;
  addressId: UUID;
  contactName?: string;
  contactPhone?: string;
  costCenterId?: UUID;
  isWarehouse: boolean;
}

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

export interface CompanyService {
  listTeamMembers(companyId: UUID, callerRole: Role): Promise<ServiceResult<TeamMember[]>>;

  /** Company profile fields (section 10) - name, registration/tax numbers, industry, contact
   *  details. Requires SETTINGS_MANAGE and that `caller` actually belongs to this company. */
  updateCompanyProfile(companyId: UUID, patch: CompanyProfilePatch, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Company>>;

  listDepartments(companyId: UUID): Promise<ServiceResult<Department[]>>;
  createDepartment(companyId: UUID, name: string, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Department>>;
  removeDepartment(departmentId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;

  listCostCenters(companyId: UUID): Promise<ServiceResult<CostCenter[]>>;
  createCostCenter(
    companyId: UUID,
    code: string,
    name: string,
    departmentId: UUID | undefined,
    callerRole: Role,
    caller: TenantContext,
  ): Promise<ServiceResult<CostCenter>>;
  removeCostCenter(costCenterId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;

  listBranches(companyId: UUID): Promise<ServiceResult<Branch[]>>;
  createBranch(input: NewBranchInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Branch>>;
  removeBranch(branchId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
}

class MockCompanyService implements CompanyService {
  async listTeamMembers(companyId: UUID, callerRole: Role): Promise<ServiceResult<TeamMember[]>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.USERS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const members = allCompanyUsers()
      .filter((cu) => cu.companyId === companyId)
      .map((membership) => {
        const user = allUsers().find((u) => u.id === membership.userId);
        return user ? { membership, user } : null;
      })
      .filter((m): m is TeamMember => m !== null);
    return ok(members);
  }

  async updateCompanyProfile(
    companyId: UUID,
    patch: CompanyProfilePatch,
    callerRole: Role,
    caller: TenantContext,
  ): Promise<ServiceResult<Company>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, companyId)) return fail('NOT_FOUND', 'That company could not be found.');

    writeCompanyProfileOverride(companyId, patch);
    const company = allCompanies().find((c) => c.id === companyId);
    if (!company) return fail('NOT_FOUND', 'That company could not be found.');
    return ok(company);
  }

  async listDepartments(companyId: UUID): Promise<ServiceResult<Department[]>> {
    await delay(200);
    return ok(allDepartments().filter((d) => d.companyId === companyId));
  }

  async createDepartment(companyId: UUID, name: string, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Department>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, companyId)) return fail('NOT_FOUND', 'That company could not be found.');
    if (!name.trim()) return fail('EMPTY', 'Give the department a name.');

    const department: Department = { id: newId('dept'), companyId, name: name.trim() };
    appendToList(DEPARTMENT_STORE_KEY, department);
    return ok(department);
  }

  async removeDepartment(departmentId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const department = allDepartments().find((d) => d.id === departmentId);
    if (!department || !ownsRecord(caller, department.companyId)) return fail('NOT_FOUND', 'That department could not be found.');

    markRemoved(departmentId);
    return ok(undefined);
  }

  async listCostCenters(companyId: UUID): Promise<ServiceResult<CostCenter[]>> {
    await delay(200);
    return ok(allCostCenters().filter((c) => c.companyId === companyId));
  }

  async createCostCenter(
    companyId: UUID,
    code: string,
    name: string,
    departmentId: UUID | undefined,
    callerRole: Role,
    caller: TenantContext,
  ): Promise<ServiceResult<CostCenter>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, companyId)) return fail('NOT_FOUND', 'That company could not be found.');
    if (!code.trim() || !name.trim()) return fail('EMPTY', 'Give the cost center a code and a name.');

    const costCenter: CostCenter = { id: newId('cc'), companyId, code: code.trim(), name: name.trim(), departmentId };
    appendToList(COST_CENTER_STORE_KEY, costCenter);
    return ok(costCenter);
  }

  async removeCostCenter(costCenterId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const costCenter = allCostCenters().find((c) => c.id === costCenterId);
    if (!costCenter || !ownsRecord(caller, costCenter.companyId)) return fail('NOT_FOUND', 'That cost center could not be found.');

    markRemoved(costCenterId);
    return ok(undefined);
  }

  async listBranches(companyId: UUID): Promise<ServiceResult<Branch[]>> {
    await delay(200);
    return ok(allBranches().filter((b) => b.companyId === companyId));
  }

  async createBranch(input: NewBranchInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Branch>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, input.companyId)) return fail('NOT_FOUND', 'That company could not be found.');
    if (!input.name.trim()) return fail('EMPTY', 'Give the branch a name.');

    const branch: Branch = {
      id: newId('branch'),
      companyId: input.companyId,
      name: input.name.trim(),
      addressId: input.addressId,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      costCenterId: input.costCenterId,
      isWarehouse: input.isWarehouse,
      createdAt: new Date().toISOString(),
    };
    appendToList(BRANCH_STORE_KEY, branch);
    return ok(branch);
  }

  async removeBranch(branchId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const branch = allBranches().find((b) => b.id === branchId);
    if (!branch || !ownsRecord(caller, branch.companyId)) return fail('NOT_FOUND', 'That branch could not be found.');
    if (branch.isHeadOffice) return fail('INVALID_STATE', 'The head office branch cannot be removed.');

    markRemoved(branchId);
    return ok(undefined);
  }
}

export const companyService: CompanyService = new MockCompanyService();
