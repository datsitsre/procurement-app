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

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

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

export interface NewInvitationInput {
  email: string;
  role: Role;
  name?: string;
  phone?: string;
  department?: string;
}

export interface CreatedInvitation {
  invitation: InvitationSummary;
  /** The raw invitation link/token - present exactly once, in this response only. This app has
   *  no email delivery, so the inviter shares it out of band. */
  token: string;
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
  status: 'ACTIVE' | 'SUSPENDED';
}

/** A platform admin's view of one organization member - see server/dto/company.ts's DTOs for
 *  confirmation that neither passwordHash nor any token/secret is ever part of this shape. */
export interface PlatformOrgMember {
  userId: UUID;
  name: string;
  email: string;
  role: Role;
  status: string;
  joinedAt?: string;
}

export interface NewPlatformCompanyInput {
  name: string;
  country: string;
  currency: string;
  legalName?: string;
  registrationNumber?: string;
  taxId?: string;
  industry?: string;
  website?: string;
  phone?: string;
  email?: string;
  description?: string;
  creditTerms?: 'PREPAID' | 'NET_7' | 'NET_15' | 'NET_30' | 'NET_60';
}

/** The Super Admin Add Company wizard's full payload (mirrors AddCompanyWizardSchema on the
 *  server exactly). */
export interface AddCompanyWizardInput extends NewPlatformCompanyInput {
  companyType: 'LIMITED_LIABILITY' | 'SOLE_PROPRIETORSHIP' | 'PARTNERSHIP' | 'PUBLIC_LIMITED' | 'NGO' | 'GOVERNMENT' | 'OTHER';
  businessRole: 'BUYER' | 'SUPPLIER' | 'BUYER_AND_SUPPLIER';
  addressLine1: string;
  defaultPaymentMethod?: 'CARD' | 'BANK_TRANSFER' | 'MTN_MOMO' | 'TELECEL_CASH' | 'AIRTELTIGO_MONEY' | 'WALLET' | 'CREDIT_TERMS';
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  initialAdministrator?: {
    name: string;
    email: string;
    phone?: string;
    role: 'OWNER' | 'ADMIN';
  };
}

export interface CreatedCompanyResult extends Company {
  /** Present only when `initialAdministrator` was supplied and the invite succeeded - the raw
   *  invitation link/token, exactly once. This app has no email delivery, so the wizard shows
   *  this once for the Super Admin to copy and share out of band. */
  invitation?: { token: string; email: string; role: 'OWNER' | 'ADMIN' };
}

export interface CompanyService {
  /** Every real buyer company on the platform (Phase 26 follow-up) - PLATFORM_SUPER_ADMIN/legacy
   *  PLATFORM_ADMIN only, per the real `GET /api/admin/companies` route's own permission gate
   *  (PLATFORM_COMPANIES_VIEW as of Phase 28). Replaces the prior `allCompanies()`
   *  localStorage-mock read the Companies page used to use, which could show stale/incomplete
   *  browser-local data instead of the real production roster. */
  listAllCompanies(): Promise<ServiceResult<PlatformCompanyRow[]>>;

  /** Creates a new buyer company as a platform administrator (Phase 28) -
   *  POST /api/admin/companies, PLATFORM_COMPANIES_CREATE. */
  createCompany(input: NewPlatformCompanyInput): Promise<ServiceResult<Company>>;

  /** The full Add Company wizard - same endpoint as createCompany above (POST /api/admin/companies
   *  accepts a strict superset of fields), but typed for the wizard's complete payload and
   *  response (including the one-time initial-administrator invitation link, if requested). */
  createCompanyWithAdministrator(input: AddCompanyWizardInput): Promise<ServiceResult<CreatedCompanyResult>>;

  /** Edits an existing company's profile as a platform administrator (Phase 28) -
   *  PATCH /api/admin/companies/[companyId], PLATFORM_COMPANIES_UPDATE. Distinct from
   *  `updateCompanyProfile` below (that company's own OWNER/ADMIN editing themselves). */
  updateCompanyAsPlatformAdmin(companyId: UUID, patch: Partial<NewPlatformCompanyInput>): Promise<ServiceResult<Company>>;

  /** A specific company's own member list, from the platform admin side (Phase 28) -
   *  GET /api/admin/companies/[companyId]/members, PLATFORM_MEMBERS_VIEW. Never a platform-wide
   *  directory - scoped to one already-identified company. */
  listCompanyMembersAsPlatformAdmin(companyId: UUID): Promise<ServiceResult<PlatformOrgMember[]>>;

  /** Suspends a company (Phase 28 follow-up - Company Organization Management) -
   *  POST /api/admin/companies/[companyId]/suspend, PLATFORM_COMPANIES_SUSPEND. Blocks the
   *  company's own users from ordinary transactional operations; platform admins keep access. */
  suspendCompany(companyId: UUID): Promise<ServiceResult<Company>>;

  /** Reactivates a suspended company (Phase 28 follow-up) -
   *  POST /api/admin/companies/[companyId]/activate, PLATFORM_COMPANIES_ACTIVATE. */
  activateCompany(companyId: UUID): Promise<ServiceResult<Company>>;

  /** A single company's full profile - GET /api/companies/[companyId] requires no specific
   *  permission beyond the tenant check (see that route's own code), which PLATFORM_SUPER_ADMIN/
   *  legacy PLATFORM_ADMIN pass via the same ownsRecord `isPlatformAdmin` bypass their cross-
   *  company transaction access already relies on - so this already works for a "View company"
   *  action from the platform Companies page, unlike editing/team/audit-log access on another
   *  company (all separately permission-gated, and not yet granted to any platform role). */
  getCompanyProfile(companyId: UUID): Promise<ServiceResult<Company>>;

  listTeamMembers(companyId: UUID, callerRole: Role): Promise<ServiceResult<TeamMember[]>>;
  addTeamMember(companyId: UUID, input: NewTeamMemberInput, callerRole: Role): Promise<ServiceResult<AddedTeamMember>>;
  /** Edits an existing member's role/department, and optionally their own account's name/avatar -
   *  the Team page's "Edit" action, for someone already on the list. */
  updateTeamMember(companyId: UUID, userId: UUID, patch: TeamMemberPatch, callerRole: Role): Promise<ServiceResult<TeamMember>>;

  /** Suspends a team member on the caller's own company (Company User Management follow-up) -
   *  POST /api/companies/[companyId]/team/[userId]/suspend, USERS_MANAGE. */
  suspendTeamMember(companyId: UUID, userId: UUID): Promise<ServiceResult<TeamMember>>;
  /** Reactivates a suspended (or offboarded) team member - POST .../activate. */
  activateTeamMember(companyId: UUID, userId: UUID): Promise<ServiceResult<TeamMember>>;
  /** Offboards a team member - removes their active access while preserving the User record and
   *  every historical business record - POST .../offboard. */
  offboardTeamMember(companyId: UUID, userId: UUID): Promise<ServiceResult<TeamMember>>;
  /** Triggers a password reset for a team member - returns the raw reset token/link once, for the
   *  admin to share out of band (this app has no email delivery) - POST .../reset-password. */
  requestTeamMemberPasswordReset(companyId: UUID, userId: UUID): Promise<ServiceResult<{ token: string; expiresAt: string }>>;

  /** Invites someone to the caller's own company (Real Invitation + Onboarding phase) - the
   *  primary "Add User" action, replacing immediate account creation. Returns the raw invitation
   *  link/token once. POST /api/companies/[companyId]/team/invite. */
  inviteTeamMember(companyId: UUID, input: NewInvitationInput): Promise<ServiceResult<CreatedInvitation>>;
  /** This company's own not-yet-accepted invitations - GET .../team/invitations. */
  listPendingInvitations(companyId: UUID): Promise<ServiceResult<InvitationSummary[]>>;
  /** Regenerates an invitation's token, invalidating the previous link - POST .../resend. */
  resendInvitation(companyId: UUID, invitationId: UUID): Promise<ServiceResult<CreatedInvitation>>;
  /** Revokes a pending invitation - POST .../revoke. */
  revokeInvitation(companyId: UUID, invitationId: UUID): Promise<ServiceResult<InvitationSummary>>;

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

  async createCompany(input: NewPlatformCompanyInput): Promise<ServiceResult<Company>> {
    return apiRequest<Company>('/api/admin/companies', { method: 'POST', body: JSON.stringify(input) });
  }

  async createCompanyWithAdministrator(input: AddCompanyWizardInput): Promise<ServiceResult<CreatedCompanyResult>> {
    return apiRequest<CreatedCompanyResult>('/api/admin/companies', { method: 'POST', body: JSON.stringify(input) });
  }

  async updateCompanyAsPlatformAdmin(companyId: UUID, patch: Partial<NewPlatformCompanyInput>): Promise<ServiceResult<Company>> {
    return apiRequest<Company>(`/api/admin/companies/${companyId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  async listCompanyMembersAsPlatformAdmin(companyId: UUID): Promise<ServiceResult<PlatformOrgMember[]>> {
    return apiRequest<PlatformOrgMember[]>(`/api/admin/companies/${companyId}/members`);
  }

  async suspendCompany(companyId: UUID): Promise<ServiceResult<Company>> {
    return apiRequest<Company>(`/api/admin/companies/${companyId}/suspend`, { method: 'POST' });
  }

  async activateCompany(companyId: UUID): Promise<ServiceResult<Company>> {
    return apiRequest<Company>(`/api/admin/companies/${companyId}/activate`, { method: 'POST' });
  }

  async getCompanyProfile(companyId: UUID): Promise<ServiceResult<Company>> {
    return apiRequest<Company>(`/api/companies/${companyId}`);
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

  async suspendTeamMember(companyId: UUID, userId: UUID): Promise<ServiceResult<TeamMember>> {
    return apiRequest<TeamMember>(`/api/companies/${companyId}/team/${userId}/suspend`, { method: 'POST' });
  }

  async activateTeamMember(companyId: UUID, userId: UUID): Promise<ServiceResult<TeamMember>> {
    return apiRequest<TeamMember>(`/api/companies/${companyId}/team/${userId}/activate`, { method: 'POST' });
  }

  async offboardTeamMember(companyId: UUID, userId: UUID): Promise<ServiceResult<TeamMember>> {
    return apiRequest<TeamMember>(`/api/companies/${companyId}/team/${userId}/offboard`, { method: 'POST' });
  }

  async requestTeamMemberPasswordReset(companyId: UUID, userId: UUID): Promise<ServiceResult<{ token: string; expiresAt: string }>> {
    return apiRequest<{ token: string; expiresAt: string }>(`/api/companies/${companyId}/team/${userId}/reset-password`, { method: 'POST' });
  }

  async inviteTeamMember(companyId: UUID, input: NewInvitationInput): Promise<ServiceResult<CreatedInvitation>> {
    return apiRequest<CreatedInvitation>(`/api/companies/${companyId}/team/invite`, { method: 'POST', body: JSON.stringify(input) });
  }

  async listPendingInvitations(companyId: UUID): Promise<ServiceResult<InvitationSummary[]>> {
    return apiRequest<InvitationSummary[]>(`/api/companies/${companyId}/team/invitations`);
  }

  async resendInvitation(companyId: UUID, invitationId: UUID): Promise<ServiceResult<CreatedInvitation>> {
    return apiRequest<CreatedInvitation>(`/api/companies/${companyId}/team/invitations/${invitationId}/resend`, { method: 'POST' });
  }

  async revokeInvitation(companyId: UUID, invitationId: UUID): Promise<ServiceResult<InvitationSummary>> {
    return apiRequest<InvitationSummary>(`/api/companies/${companyId}/team/invitations/${invitationId}/revoke`, { method: 'POST' });
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
