import { apiRequest } from './base';
import { writeCompanyProfileOverride } from './auth.service';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Branch, Company, CompanyUser, CostCenter, Department, User } from '@/types/company';
import type { Role } from '@/config/rbac';

export interface TeamMember {
  membership: CompanyUser;
  user: User;
}

export interface AddedTeamMember extends TeamMember {
  /** Set only when adding this person created a brand-new account (no existing account matched
   *  the email) - the generated password to share with them, since this app has no email
   *  delivery to send an invite link through instead. */
  temporaryPassword?: string;
}

export interface NewTeamMemberInput {
  email: string;
  /** Only required when no account exists yet for `email`. */
  name?: string;
  role: Role;
  department?: string;
}

export interface TeamMemberPatch {
  role?: Role;
  department?: string;
  name?: string;
  /** A data: URI, or '' to remove the current photo. `undefined` leaves it untouched - see
   *  server/services/user.service.ts's own comment on why a data URI, not a real upload. */
  avatarUrl?: string;
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

/** One row of the platform-wide company directory - see server/services/company.service.ts's
 *  own PlatformCompanyRow for exactly which fields this is and isn't. */
export interface PlatformCompanyRow {
  id: UUID;
  name: string;
  country: string;
  currency: string;
  creditTerms: string;
  memberCount: number;
  createdAt: string;
}

export interface CompanyService {
  /** Every real buyer company on the platform (Phase 26 follow-up) - PLATFORM_SUPER_ADMIN/legacy
   *  PLATFORM_ADMIN only, per the real `GET /api/admin/companies` route's own permission gate.
   *  Replaces the prior `allCompanies()` localStorage-mock read the Companies page used to use,
   *  which could show stale/incomplete browser-local data instead of the real production roster. */
  listAllCompanies(): Promise<ServiceResult<PlatformCompanyRow[]>>;

  listTeamMembers(companyId: UUID, callerRole: Role): Promise<ServiceResult<TeamMember[]>>;
  addTeamMember(companyId: UUID, input: NewTeamMemberInput, callerRole: Role): Promise<ServiceResult<AddedTeamMember>>;
  /** Edits an existing member's role/department, and optionally their own account's name/avatar -
   *  the Team page's "Edit" action, for someone already on the list. */
  updateTeamMember(companyId: UUID, userId: UUID, patch: TeamMemberPatch, callerRole: Role): Promise<ServiceResult<TeamMember>>;

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

/**
 * Calls the real `/api/companies/[companyId]/*` backend (Phase 14, Stage 3; spending limits
 * joined in Stage 6, alongside procurement.service.ts's createPurchaseRequest which enforces
 * them) for company identity/workspace data - profile, departments, cost centers, branches,
 * team, spending limits. `callerRole`/`caller` are still accepted on several methods (every
 * existing page already passes them) but are never sent over the wire and never trusted for
 * authorization - the API derives the caller's role and tenant from the session cookie itself
 * (server/auth/require.ts). Keeping these parameters means every consuming page needed zero
 * changes.
 */
class ApiCompanyService implements CompanyService {
  async listAllCompanies(): Promise<ServiceResult<PlatformCompanyRow[]>> {
    return apiRequest<PlatformCompanyRow[]>('/api/admin/companies');
  }

  async listTeamMembers(companyId: UUID): Promise<ServiceResult<TeamMember[]>> {
    return apiRequest<TeamMember[]>(`/api/companies/${companyId}/team`);
  }

  async addTeamMember(companyId: UUID, input: NewTeamMemberInput): Promise<ServiceResult<AddedTeamMember>> {
    return apiRequest<AddedTeamMember>(`/api/companies/${companyId}/team`, { method: 'POST', body: JSON.stringify(input) });
  }

  async updateTeamMember(companyId: UUID, userId: UUID, patch: TeamMemberPatch): Promise<ServiceResult<TeamMember>> {
    return apiRequest<TeamMember>(`/api/companies/${companyId}/team/${userId}`, { method: 'PATCH', body: JSON.stringify(patch) });
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
    return apiRequest<{ role: Role; amount: number | undefined }[]>(`/api/companies/${companyId}/spending-limits`);
  }

  async setSpendingLimit(companyId: UUID, role: Role, amount: number): Promise<ServiceResult<void>> {
    return apiRequest<void>(`/api/companies/${companyId}/spending-limits/${role}`, { method: 'PATCH', body: JSON.stringify({ amount }) });
  }
}

export const companyService: CompanyService = new ApiCompanyService();
