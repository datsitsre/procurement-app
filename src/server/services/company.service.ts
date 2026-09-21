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
  creditTerms?: 'PREPAID' | 'NET_7' | 'NET_15' | 'NET_30' | 'NET_60';
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
  status: 'ACTIVE' | 'SUSPENDED';
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
      status: true,
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
      status: c.status,
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

export interface NewPlatformCompanyInput extends CompanyProfilePatch {
  name: string;
  country: string;
  currency: string;
  /// Every field below is optional and a genuine Company column (Add Company wizard follow-up) -
  /// safe to spread directly into db.company.create alongside everything CompanyProfilePatch
  /// already covers, unlike businessRole/addressLine1/initialAdministrator (see
  /// AddCompanyWizardInput below), which are wizard-only orchestration inputs, not Company columns.
  companyType?: 'LIMITED_LIABILITY' | 'SOLE_PROPRIETORSHIP' | 'PARTNERSHIP' | 'PUBLIC_LIMITED' | 'NGO' | 'GOVERNMENT' | 'OTHER';
  defaultPaymentMethod?: 'CARD' | 'BANK_TRANSFER' | 'MTN_MOMO' | 'TELECEL_CASH' | 'AIRTELTIGO_MONEY' | 'WALLET' | 'CREDIT_TERMS';
  /// Sensitive - never selected by listAllCompanies, never placed in audit metadata (see
  /// createCompanyWithAdministrator's own comment), never logged.
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
}

/** A platform administrator creating a new buyer company directly (Phase 28, section 5) -
 *  always `isBuyer: true, isSupplier: false`. Deliberately creates no User/CompanyMembership,
 *  no Address, and no invitation - the bare-minimum creation path. Superseded as the actual
 *  POST /api/admin/companies handler by `createCompanyWithAdministrator` below (the Add Company
 *  wizard follow-up), which is a strict superset - calling it with none of businessRole/
 *  addressLine1/initialAdministrator set produces byte-identical behavior to this function. Kept
 *  exported and unchanged for any future direct caller that only ever wants the bare row. */
export async function createCompanyAsPlatformAdmin(
  input: NewPlatformCompanyInput,
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<Company>> {
  const company = await db.company.create({
    data: { ...input, isBuyer: true, isSupplier: false },
    include: { addresses: true, parentGroup: true },
  });

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId: company.id,
    action: 'PLATFORM_COMPANY_CREATED',
    entityType: 'Company',
    entityId: company.id,
    newValue: { name: company.name, country: company.country, currency: company.currency },
  });

  return ok(toCompanyDto(company));
}

export interface InitialAdministratorInput {
  name: string;
  email: string;
  phone?: string;
  role: 'OWNER' | 'ADMIN';
}

export interface AddCompanyWizardInput extends NewPlatformCompanyInput {
  /** Maps to isBuyer/isSupplier - defaults to BUYER (isBuyer: true, isSupplier: false), matching
   *  createCompanyAsPlatformAdmin's own hardcoded default exactly, so a request that omits this
   *  behaves identically to the pre-wizard endpoint. Never creates a SupplierProfile even when
   *  SUPPLIER/BUYER_AND_SUPPLIER is chosen - a supplier needs its own required onboarding fields
   *  (slug, city, description, ...) this wizard doesn't collect; isSupplier is set honestly, but
   *  completing a real supplier profile remains a separate, existing step via /admin/suppliers -
   *  a genuine, disclosed limitation, not a fabricated SupplierProfile. */
  businessRole?: 'BUYER' | 'SUPPLIER' | 'BUYER_AND_SUPPLIER';
  /** Only Address Line 1 and Country are ever collected (Add Company wizard's own Address step
   *  deliberately excludes City/Region) - see the Address model's own comment on why `city` is
   *  nullable rather than fed a fabricated placeholder value. No Address row is created at all
   *  when this is omitted, matching pre-wizard behavior exactly. */
  addressLine1?: string;
  /** When present, invites this person as the company's first OWNER/ADMIN via the existing
   *  invitation architecture (never an immediately-ACTIVE account with a temporary password) -
   *  see inviteInitialCompanyAdministrator's own comment for why this bypasses
   *  inviteTeamMember's OWNER_ROLE_RESTRICTED guard specifically for this one case. */
  initialAdministrator?: InitialAdministratorInput;
}

export interface CreatedCompanyWithInvitation {
  company: Company;
  /** Present only when `initialAdministrator` was supplied and the invitation was created
   *  successfully - the raw invitation link/token, exactly once, the same "no email delivery,
   *  show once" pattern the rest of this app already uses. Never present if invitation creation
   *  failed - the company itself is still created either way (see this function's own comment on
   *  why company creation and the administrator invitation are two separately-atomic steps, not
   *  one cross-service transaction). */
  invitation?: { token: string; email: string; role: 'OWNER' | 'ADMIN' };
}

/** The real POST /api/admin/companies handler as of the Add Company wizard follow-up - a strict
 *  superset of createCompanyAsPlatformAdmin above (calling it with none of businessRole/
 *  addressLine1/initialAdministrator set is byte-identical to that function, including the exact
 *  same PLATFORM_COMPANY_CREATED audit entry - confirmed by the existing route test suite, which
 *  still exercises exactly that minimal payload shape and continues to pass unmodified).
 *
 *  Two independently-atomic steps, not one cross-service transaction: (1) create the Company row
 *  (+ its one Address row, if addressLine1 was given) in a single db.$transaction, then (2) if
 *  an initial administrator was given, invite them via invitation.service.ts's own
 *  inviteInitialCompanyAdministrator. If step 2 fails, the company from step 1 still exists (and
 *  is fully visible/manageable in /admin/companies) - a platform admin can always retry the
 *  invitation separately via that company's own Team page. A single Company row with no pending
 *  invitation is a recoverable, honest state; a company that silently vanished because of an
 *  unrelated invitation failure would not be. */
export async function createCompanyWithAdministrator(
  input: AddCompanyWizardInput,
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<CreatedCompanyWithInvitation>> {
  const { businessRole, addressLine1, initialAdministrator, ...companyFields } = input;

  if (companyFields.registrationNumber?.trim()) {
    const duplicate = await db.company.findFirst({ where: { registrationNumber: companyFields.registrationNumber.trim() } });
    if (duplicate) return fail('DUPLICATE_REGISTRATION_NUMBER', 'A company with this registration number already exists.');
  }

  const isBuyer = businessRole !== 'SUPPLIER';
  const isSupplier = businessRole === 'SUPPLIER' || businessRole === 'BUYER_AND_SUPPLIER';

  const company = await db.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: { ...companyFields, isBuyer, isSupplier },
      include: { addresses: true, parentGroup: true },
    });
    if (addressLine1?.trim()) {
      await tx.address.create({
        data: { companyId: created.id, label: 'Main Address', line1: addressLine1.trim(), country: created.country, isDefault: true },
      });
    }
    return created;
  });

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId: company.id,
    action: 'PLATFORM_COMPANY_CREATED',
    // Never bank details, never the initial administrator's email/invitation token here -
    // exactly the same safe fields the pre-wizard audit entry already recorded.
    entityType: 'Company',
    entityId: company.id,
    newValue: { name: company.name, country: company.country, currency: company.currency },
  });

  const full = await db.company.findUniqueOrThrow({ where: { id: company.id }, include: { addresses: true, parentGroup: true } });

  if (!initialAdministrator) {
    return ok({ company: toCompanyDto(full) });
  }

  const { inviteInitialCompanyAdministrator } = await import('./invitation.service');
  const invited = await inviteInitialCompanyAdministrator(
    company.id,
    { name: initialAdministrator.name, email: initialAdministrator.email, phone: initialAdministrator.phone, role: initialAdministrator.role },
    actor,
  );
  if (!invited.ok) {
    // The company itself was created successfully - only the invitation step failed (e.g. this
    // exact email already has a pending invitation somewhere implausible). Return the company
    // anyway so the platform admin isn't left believing nothing happened; they can invite the
    // administrator separately from the new company's own Team page.
    return ok({ company: toCompanyDto(full) });
  }

  return ok({
    company: toCompanyDto(full),
    invitation: { token: invited.data.token, email: invited.data.invitation.email, role: initialAdministrator.role },
  });
}

export interface PublicRegistrationAdministrator {
  name: string;
  email: string;
  phone?: string;
  role: 'OWNER' | 'ADMIN';
  /** Hashed by the route (an auth-domain concern, kept there - see /api/auth/register/route.ts's
   *  own inline hashPassword call for the precedent), never a raw password reaching this layer.
   *  Ignored entirely when the email matches an existing User - their password is never touched. */
  passwordHash: string;
}

export interface PublicCompanyRegistrationInput {
  name: string;
  legalName: string;
  registrationNumber: string;
  companyType: NonNullable<AddCompanyWizardInput['companyType']>;
  email: string;
  phone: string;
  website: string;
  businessRole: NonNullable<AddCompanyWizardInput['businessRole']>;
  addressLine1: string;
  country: string;
  currency: string;
  creditTerms?: 'PREPAID' | 'NET_7' | 'NET_15' | 'NET_30' | 'NET_60';
  defaultPaymentMethod?: NonNullable<AddCompanyWizardInput['defaultPaymentMethod']>;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  administrator: PublicRegistrationAdministrator;
}

export interface PublicCompanyRegistrationResult {
  companyId: UUID;
  companyName: string;
  registeredEmail: string;
  /** Always PENDING_APPROVAL - reuses the exact same MembershipStatus gate self-registration
   *  (POST /api/auth/register, Phase 26) already relies on: resolveTenant/buildSessionPayload
   *  already treat any non-ACTIVE membership as "no tenant, no role" - see decideRegistration
   *  (platformUsers.service.ts) for how a platform admin later approves/rejects it. No new
   *  approval mechanism, no Company-level status invented. */
  registrationStatus: 'PENDING_APPROVAL';
}

/**
 * PUBLIC COMPANY REGISTRATION PAGE phase - the real POST /api/auth/register/company handler.
 * Deliberately its own function, not a reuse of createCompanyWithAdministrator above: that one
 * is a platform admin vouching for a company on someone else's behalf (invites a *different*
 * person via a secure link); this one is an unauthenticated visitor registering their own
 * company and becoming its own administrator in the same request, following the exact same
 * PENDING_APPROVAL lifecycle POST /api/auth/register already established. Both ultimately create
 * a Company + User + CompanyMembership - the lifecycle and lockout mechanism are shared and
 * never duplicated, only the entry point and required fields differ.
 *
 * SECURITY HARDENING phase - existing-account handling (section 10) changed from "reuse the
 * account" to "refuse and point at /login". Reusing an existing User by email alone let anyone
 * who merely *knew* someone else's email address attach a new PENDING_APPROVAL membership to
 * their account without proving they owned it - a real, if low-severity, account-confusion risk
 * (see this function's own git history for the prior behavior and its reasoning). Now: an
 * `administrator.email` that already belongs to a User is rejected up front, before any
 * database write - no Company, no Address, no CompanyMembership, no audit entry are created for
 * that attempt at all. The existing User is never read for anything beyond the existence check
 * itself (no password, role, membership, or status field is ever inspected or returned) and is
 * never modified. A genuine account owner who wants to register a new company must sign in first
 * - see ACCOUNT_EXISTS's own comment on the route for that flow. No new authentication system;
 * this only redirects to the existing /login.
 */
export async function registerCompanyPublicly(
  input: PublicCompanyRegistrationInput,
): Promise<ServiceResult<PublicCompanyRegistrationResult>> {
  const { administrator, businessRole, addressLine1, ...companyFields } = input;
  const administratorEmail = administrator.email.toLowerCase();

  // Checked first, before the registration-number check too - an anonymous visitor should learn
  // nothing about whether a *company* detail collides until we've already established they're not
  // trying to attach themselves to someone else's account.
  const existingUser = await db.user.findUnique({ where: { email: administratorEmail }, select: { id: true } });
  if (existingUser) {
    return fail('ACCOUNT_EXISTS', 'An account already exists for this email. Sign in to continue.');
  }

  if (companyFields.registrationNumber.trim()) {
    const duplicate = await db.company.findFirst({ where: { registrationNumber: companyFields.registrationNumber.trim() } });
    if (duplicate) return fail('DUPLICATE_REGISTRATION_NUMBER', 'A company with this registration number already exists.');
  }

  const isBuyer = businessRole !== 'SUPPLIER';
  const isSupplier = businessRole === 'SUPPLIER' || businessRole === 'BUYER_AND_SUPPLIER';

  const created = await db.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { ...companyFields, isBuyer, isSupplier } });
    if (addressLine1.trim()) {
      await tx.address.create({
        data: { companyId: company.id, label: 'Main Address', line1: addressLine1.trim(), country: company.country, isDefault: true },
      });
    }
    // Always a brand-new User here - the ACCOUNT_EXISTS check above already returned early for
    // any email that matches an existing account, so this create can never collide.
    const user = await tx.user.create({ data: { name: administrator.name, email: administratorEmail, passwordHash: administrator.passwordHash } });
    await tx.companyMembership.create({
      data: { companyId: company.id, userId: user.id, role: administrator.role, status: 'PENDING_APPROVAL' },
    });
    return { company, user };
  });

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: created.user.id,
    actorName: administrator.name,
    companyId: created.company.id,
    action: 'COMPANY_SELF_REGISTERED',
    // Never bank details, never a password/hash here - the same safe field set every other
    // company-creation audit entry in this app already records.
    entityType: 'Company',
    entityId: created.company.id,
    newValue: { name: created.company.name, country: created.company.country, currency: created.company.currency },
  });

  return ok({
    companyId: created.company.id,
    companyName: created.company.name,
    registeredEmail: administratorEmail,
    registrationStatus: 'PENDING_APPROVAL',
  });
}

/** A platform administrator editing an existing company's own profile metadata (Phase 28,
 *  section 6) - the same `updateCompanyProfile` a company's own OWNER/ADMIN uses on themselves,
 *  wrapped with an explicit audit entry this cross-company edit needs but the self-service path
 *  doesn't (a company editing its own profile isn't a "cross-company" action to audit). */
export async function updateCompanyAsPlatformAdmin(
  companyId: UUID,
  patch: CompanyProfilePatch,
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<Company>> {
  const before = await db.company.findUnique({ where: { id: companyId } });
  if (!before) return fail('NOT_FOUND', 'That company could not be found.');

  const result = await updateCompanyProfile(companyId, patch);
  if (!result.ok) return result;

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: 'PLATFORM_COMPANY_UPDATED',
    entityType: 'Company',
    entityId: companyId,
    previousValue: { name: before.name, industry: before.industry ?? undefined },
    newValue: patch,
  });

  return result;
}

/** Suspends or reactivates a company (Phase 28 follow-up - Company Organization Management).
 *  Both directions share this one function - the transition itself (which status is required,
 *  which status results, which audit action fires) is the only thing that differs.
 *
 *  Guards, in order (defense in depth - re-derived here independently of the route's own
 *  permission gate, the same reasoning platformUsers.service.ts's changePlatformRole gives):
 *  1. The company must exist and actually be a buyer company - never a supplier (which keeps its
 *     own, separate verification-based lifecycle - section 10's own instruction) or a
 *     platform-type company (which has no lifecycle to suspend at all).
 *  2. The transition must be a real state change - an atomic conditional `updateMany` requiring
 *     the *current* status, not a plain `update` - so two concurrent suspend calls (or a
 *     suspend-then-activate race) can't both silently "succeed"; the loser gets a clean
 *     CONFLICT instead of a lost/duplicate audit entry. The same pattern `decideStep`/
 *     `acceptQuote`/`setMembershipStatus` already use for their own workflow-state races. */
async function transitionCompanyStatus(
  companyId: UUID,
  direction: 'SUSPEND' | 'ACTIVATE',
  actor: { userId: UUID; name: string },
): Promise<ServiceResult<Company>> {
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return fail('NOT_FOUND', 'That company could not be found.');
  if (!company.isBuyer || company.isSupplier) {
    return fail('INVALID_COMPANY_TYPE', 'Only buyer companies can be suspended or activated here - suppliers use their own verification status.');
  }

  const fromStatus = direction === 'SUSPEND' ? 'ACTIVE' : 'SUSPENDED';
  const toStatus = direction === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
  const { count } = await db.company.updateMany({ where: { id: companyId, status: fromStatus }, data: { status: toStatus } });
  if (count === 0) {
    return fail(
      'CONFLICT',
      direction === 'SUSPEND' ? 'This company is already suspended.' : 'This company is already active.',
    );
  }

  const updated = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { addresses: true, parentGroup: true } });

  const { recordAudit } = await import('./audit.service');
  await recordAudit({
    actorId: actor.userId,
    actorName: actor.name,
    companyId,
    action: direction === 'SUSPEND' ? 'PLATFORM_COMPANY_SUSPENDED' : 'PLATFORM_COMPANY_ACTIVATED',
    entityType: 'Company',
    entityId: companyId,
    previousValue: { status: fromStatus, name: company.name },
    newValue: { status: toStatus },
  });

  return ok(toCompanyDto(updated));
}

export function suspendCompany(companyId: UUID, actor: { userId: UUID; name: string }): Promise<ServiceResult<Company>> {
  return transitionCompanyStatus(companyId, 'SUSPEND', actor);
}

export function activateCompany(companyId: UUID, actor: { userId: UUID; name: string }): Promise<ServiceResult<Company>> {
  return transitionCompanyStatus(companyId, 'ACTIVATE', actor);
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

/** True when `userId` is the company's only remaining ACTIVE OWNER - the one governance state no
 *  action here may ever produce, regardless of who's asking (Part B9/B15A rule 11). Checked
 *  fresh on every call rather than cached; a company's owner roster changes rarely enough that
 *  this extra query is never a real cost. */
async function isLastActiveOwner(companyId: UUID, userId: UUID): Promise<boolean> {
  const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (!membership || membership.role !== 'OWNER' || membership.status !== 'ACTIVE') return false;
  const activeOwnerCount = await db.companyMembership.count({ where: { companyId, role: 'OWNER', status: 'ACTIVE' } });
  return activeOwnerCount <= 1;
}

/** Shared guards for every status-changing action below (suspend/activate/offboard) - defense in
 *  depth, the same reasoning changePlatformRole's own comment gives for re-deriving every check
 *  itself rather than trusting the route alone:
 *  1. No one may suspend/offboard their own membership (Part B9 rules 7/8) - reactivating
 *     yourself, were you ever suspended by someone else, stays allowed (harmless, and useful if
 *     a mistaken self-suspend ever became possible some other way).
 *  2. Only an existing OWNER may suspend/offboard another OWNER (Part B15A rule 10 - "ADMIN
 *     cannot improperly remove or demote the controlling OWNER"), mirroring updateTeamMember's
 *     own OWNER_ROLE_RESTRICTED exactly.
 *  3. The company's last remaining ACTIVE OWNER can never be suspended/offboarded by anyone,
 *     including another OWNER (Part B15A rule 11) - there is no existing "last owner" guard
 *     anywhere in this file to reuse (confirmed by inspection), so this is new. */
async function assertCanChangeMemberStanding(
  companyId: UUID,
  userId: UUID,
  targetRole: Role,
  actor: { userId: UUID; role: Role },
  action: 'SUSPEND' | 'OFFBOARD',
): Promise<{ code: string; message: string } | null> {
  if (actor.userId === userId) {
    return {
      code: action === 'SUSPEND' ? 'SELF_SUSPEND_DENIED' : 'SELF_OFFBOARD_DENIED',
      message: action === 'SUSPEND' ? 'You cannot suspend your own account.' : 'You cannot offboard your own account.',
    };
  }
  if (targetRole === 'OWNER' && actor.role !== 'OWNER') {
    return { code: 'OWNER_ROLE_RESTRICTED', message: 'Only an existing owner can suspend or offboard another owner.' };
  }
  if (await isLastActiveOwner(companyId, userId)) {
    return { code: 'LAST_OWNER_PROTECTED', message: 'This is the only remaining owner - promote another owner first.' };
  }
  return null;
}

/** Suspends or reactivates a company's own team member (Part B7) - reuses the exact
 *  CompanyMembership.status field/enum every other membership-lifecycle transition in this app
 *  already uses (platformUsers.service.ts's setMembershipStatus, the Company suspend/activate
 *  work), never a second status field. The atomic conditional `updateMany` (not read-then-write)
 *  is the same workflow-state-race pattern used throughout this codebase. Enforcement of what
 *  "suspended" means for this person's own access lives centrally in resolveTenant
 *  (server/auth/context.ts) - a non-ACTIVE CompanyMembership already resolves an empty, fail-
 *  closed tenant, so no further changes were needed anywhere else for this to actually block
 *  their access. */
export async function setTeamMemberStatus(
  companyId: UUID,
  userId: UUID,
  status: 'SUSPENDED' | 'ACTIVE',
  actor: { userId: UUID; role: Role },
): Promise<ServiceResult<TeamMember>> {
  const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (!membership) return fail('NOT_FOUND', 'That team member could not be found.');

  if (status === 'SUSPENDED') {
    const denial = await assertCanChangeMemberStanding(companyId, userId, membership.role as Role, actor, 'SUSPEND');
    if (denial) return fail(denial.code, denial.message);
  }

  const fromStatus = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  const { count } = await db.companyMembership.updateMany({ where: { companyId, userId, status: fromStatus }, data: { status } });
  if (count === 0) {
    return fail('CONFLICT', `This person isn't currently ${fromStatus === 'ACTIVE' ? 'active' : 'suspended'} - their status may have already changed.`);
  }

  const updated = await db.companyMembership.findUniqueOrThrow({ where: { id: membership.id }, include: { user: true } });
  await recordTeamAudit(
    companyId,
    actor.userId,
    status === 'ACTIVE' ? 'TEAM_MEMBER_ACTIVATED' : 'TEAM_MEMBER_SUSPENDED',
    userId,
    { status },
    { status: fromStatus },
  );
  return ok({ membership: toMembershipDto(updated), user: toUserDto(updated.user) });
}

/** Offboards a company's own team member (Part B8). Deliberately reuses the exact same
 *  CompanyMembership.status transition setTeamMemberStatus already makes (-> SUSPENDED) rather
 *  than inventing a dedicated OFFBOARDED/REMOVED enum value - MembershipStatus has no such value
 *  today, and SUSPENDED already satisfies every functional requirement an offboard needs (blocks
 *  ordinary company operations server-side via resolveTenant, is reversible via activation,
 *  leaves the User record and every historical business record - orders, invoices, audit
 *  entries - completely untouched, since none of those are deleted or altered here). The one
 *  real difference from an ordinary suspension is intent, which is captured in the audit trail
 *  (TEAM_MEMBER_OFFBOARDED, not TEAM_MEMBER_SUSPENDED) and the UI's own confirmation copy, not in
 *  the data model. A genuinely distinct terminal status (so an offboarded person could never be
 *  silently reactivated the same way a suspension is) would require a schema migration - this is
 *  a real, reported gap, not a silent workaround; see this phase's final report. */
export async function offboardTeamMember(
  companyId: UUID,
  userId: UUID,
  actor: { userId: UUID; role: Role },
): Promise<ServiceResult<TeamMember>> {
  const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (!membership) return fail('NOT_FOUND', 'That team member could not be found.');
  if (membership.status === 'SUSPENDED') {
    return fail('CONFLICT', 'This person has already been offboarded or suspended.');
  }

  const denial = await assertCanChangeMemberStanding(companyId, userId, membership.role as Role, actor, 'OFFBOARD');
  if (denial) return fail(denial.code, denial.message);

  const { count } = await db.companyMembership.updateMany({ where: { companyId, userId, status: { not: 'SUSPENDED' } }, data: { status: 'SUSPENDED' } });
  if (count === 0) return fail('CONFLICT', 'This person has already been offboarded or suspended.');

  const updated = await db.companyMembership.findUniqueOrThrow({ where: { id: membership.id }, include: { user: true } });
  await recordTeamAudit(companyId, actor.userId, 'TEAM_MEMBER_OFFBOARDED', userId, { status: 'SUSPENDED' }, { status: membership.status });
  return ok({ membership: toMembershipDto(updated), user: toUserDto(updated.user) });
}

/** Triggers a password reset for a team member on the caller's own company (Part B6). The
 *  tenant-scoping (does `userId` actually belong to `companyId`?) happens here, exactly the same
 *  `companyId_userId` compound-key lookup every other team-member action in this file uses - the
 *  actual token issuance is delegated to passwordReset.service.ts, which knows nothing about
 *  companies or tenants at all (it only ever trusts a `userId` its caller has already verified).
 *  Never returns or logs the member's existing password - there is nothing to return, since
 *  nothing here ever reads it. */
export async function requestTeamMemberPasswordReset(
  companyId: UUID,
  userId: UUID,
  actor: { userId: UUID; role: Role },
): Promise<ServiceResult<{ token: string; expiresAt: string }>> {
  const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (!membership) return fail('NOT_FOUND', 'That team member could not be found.');

  const { requestPasswordReset } = await import('./passwordReset.service');
  const result = await requestPasswordReset(userId);
  if (!result.ok) return result;

  // Metadata deliberately carries no token value, hashed or otherwise - only the fact that a
  // reset was requested and when it expires (Part B12: "never store... reset token... in audit
  // metadata").
  await recordTeamAudit(companyId, actor.userId, 'TEAM_MEMBER_PASSWORD_RESET_REQUESTED', userId, { expiresAt: result.data.expiresAt });
  return ok(result.data);
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
