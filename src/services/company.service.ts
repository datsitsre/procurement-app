import { apiRequest, assertPermission, delay, fail, ok, ownsRecord } from './base';
import { writeCompanyProfileOverride } from './auth.service';
import { DefaultSpendingLimits } from '@/config/spending-limits';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Branch, Company, CompanyUser, CostCenter, Department, User } from '@/types/company';
import { Permission, type Role } from '@/config/rbac';

export interface TeamMember {
  membership: CompanyUser;
  user: User;
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

  /** Every role's effective spending limit for this company (section 11.5) - a company's own
   *  override where one has been set, the platform default otherwise, `undefined` for no limit. */
  listSpendingLimits(companyId: UUID): Promise<ServiceResult<{ role: Role; amount: number | undefined }[]>>;
  setSpendingLimit(companyId: UUID, role: Role, amount: number, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
}

// ---------------------------------------------------------------------------------------------
// Spending limits (section 11.5) - still localStorage-backed, deliberately NOT migrated in this
// stage. procurement.service.ts's createPurchaseRequest (the thing that actually *enforces*
// this business rule) is still a client-side mock and reads spendingLimitFor() below directly;
// moving only this file's read/write to the real API without also moving enforcement would
// desync the two - Settings would appear to save a new limit that nothing then checks. Both
// move together in Stage 6, when procurement.service.ts itself migrates. See
// server/services/company.service.ts's matching comment.
// ---------------------------------------------------------------------------------------------

const SPENDING_LIMIT_STORE_KEY = 'procurement.spending-limits.v1';

function readSpendingLimitOverrides(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(SPENDING_LIMIT_STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeSpendingLimitOverride(companyId: UUID, role: Role, amount: number) {
  if (typeof window === 'undefined') return;
  const store = readSpendingLimitOverrides();
  store[`${companyId}:${role}`] = amount;
  window.localStorage.setItem(SPENDING_LIMIT_STORE_KEY, JSON.stringify(store));
}

/** The effective spending limit for one role at one company - a company's own override if it
 *  has set one, otherwise the platform default, otherwise `undefined` (no limit). Exported so
 *  procurement.service.ts can enforce it without importing this file's private storage. */
export function spendingLimitFor(companyId: UUID, role: Role): number | undefined {
  const overrides = readSpendingLimitOverrides();
  const key = `${companyId}:${role}`;
  return key in overrides ? overrides[key] : DefaultSpendingLimits[role];
}

const BUYER_ROLES_FOR_LIMITS: Role[] = ['OWNER', 'ADMIN', 'PROCUREMENT_MANAGER', 'BUYER', 'FINANCE_MANAGER', 'APPROVER', 'EMPLOYEE'];

/**
 * Calls the real `/api/companies/[companyId]/*` backend (Phase 14, Stage 3) for company
 * identity/workspace data - profile, departments, cost centers, branches, team. Spending limits
 * stay on localStorage for now (see the block comment above). `callerRole`/`caller` are still
 * accepted (every existing page already passes them) but are never sent over the wire and never
 * trusted for authorization - the API derives the caller's role and tenant from the session
 * cookie itself (server/auth/require.ts). Keeping these parameters means every consuming page
 * needed zero changes.
 */
class ApiCompanyService implements CompanyService {
  async listTeamMembers(companyId: UUID): Promise<ServiceResult<TeamMember[]>> {
    return apiRequest<TeamMember[]>(`/api/companies/${companyId}/team`);
  }

  async updateCompanyProfile(companyId: UUID, patch: CompanyProfilePatch): Promise<ServiceResult<Company>> {
    const result = await apiRequest<Company>(`/api/companies/${companyId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    // Mirror the update into the local cache other still-mock services read (allCompanies() in
    // auth.service.ts) - the real profile now lives in Postgres, but nothing outside this one
    // request re-fetches it, so without this the company switcher/dashboard/etc. would keep
    // showing the pre-edit name until the next login.
    if (result.ok) writeCompanyProfileOverride(companyId, result.data);
    return result;
  }

  async listDepartments(companyId: UUID): Promise<ServiceResult<Department[]>> {
    return apiRequest<Department[]>(`/api/companies/${companyId}/departments`);
  }

  async createDepartment(companyId: UUID, name: string): Promise<ServiceResult<Department>> {
    return apiRequest<Department>(`/api/companies/${companyId}/departments`, { method: 'POST', body: JSON.stringify({ name }) });
  }

  async removeDepartment(departmentId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That department could not be found.' } };
    return apiRequest<void>(`/api/companies/${companyId}/departments/${departmentId}`, { method: 'DELETE' });
  }

  async listCostCenters(companyId: UUID): Promise<ServiceResult<CostCenter[]>> {
    return apiRequest<CostCenter[]>(`/api/companies/${companyId}/cost-centers`);
  }

  async createCostCenter(companyId: UUID, code: string, name: string, departmentId: UUID | undefined): Promise<ServiceResult<CostCenter>> {
    return apiRequest<CostCenter>(`/api/companies/${companyId}/cost-centers`, {
      method: 'POST',
      body: JSON.stringify({ code, name, departmentId }),
    });
  }

  async removeCostCenter(costCenterId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That cost center could not be found.' } };
    return apiRequest<void>(`/api/companies/${companyId}/cost-centers/${costCenterId}`, { method: 'DELETE' });
  }

  async listBranches(companyId: UUID): Promise<ServiceResult<Branch[]>> {
    return apiRequest<Branch[]>(`/api/companies/${companyId}/branches`);
  }

  async createBranch(input: NewBranchInput): Promise<ServiceResult<Branch>> {
    const { companyId, ...body } = input;
    return apiRequest<Branch>(`/api/companies/${companyId}/branches`, { method: 'POST', body: JSON.stringify(body) });
  }

  async removeBranch(branchId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That branch could not be found.' } };
    return apiRequest<void>(`/api/companies/${companyId}/branches/${branchId}`, { method: 'DELETE' });
  }

  async listSpendingLimits(companyId: UUID): Promise<ServiceResult<{ role: Role; amount: number | undefined }[]>> {
    await delay(200);
    return ok(BUYER_ROLES_FOR_LIMITS.map((role) => ({ role, amount: spendingLimitFor(companyId, role) })));
  }

  async setSpendingLimit(companyId: UUID, role: Role, amount: number, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, companyId)) return fail('NOT_FOUND', 'That company could not be found.');
    if (amount < 0) return fail('INVALID_AMOUNT', 'Set a spending limit of zero or more.');

    writeSpendingLimitOverride(companyId, role, amount);
    return ok(undefined);
  }
}

export const companyService: CompanyService = new ApiCompanyService();
