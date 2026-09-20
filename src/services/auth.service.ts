import { apiRequest, fail, ok } from './base';
import { primeSupplierCache } from './catalog.service';
import { demoCompanies, demoCompanyUsers, demoUsers } from '@/lib/demo-data/companies';
import type { ServiceResult, UUID, CountryCode, CurrencyCode } from '@/types/common';
import type { Company, CompanyUser, User } from '@/types/company';
import { workspaceForRole, type Workspace } from '@/config/rbac';

export interface Session {
  user: User;
  /** Every company this user belongs to, with their role in each - drives the company
   *  switcher (section 10). */
  memberships: CompanyUser[];
  /** The company currently "active" in the UI - switching it must change every company-scoped
   *  view (orders, spend, suppliers, invoices) without a full page reload. */
  activeCompanyId: UUID;
}

export interface RegisterInput {
  companyName: string;
  country: CountryCode;
  currency: CurrencyCode;
  fullName: string;
  email: string;
  password: string;
}

/** What `POST /api/auth/register` actually returns (Phase 26) - a brand-new registration is
 *  never immediately active, so unlike login/switchCompany there is no `Session` to hand back
 *  here; the caller must show a pending-approval state, not navigate into the app. */
export interface RegistrationResult {
  registrationStatus: 'PENDING_APPROVAL';
  message: string;
}

export interface UserProfilePatch {
  name?: string;
  phone?: string;
  /** A data: URI, or '' to remove the current avatar. `undefined` leaves it untouched - see
   *  server/services/user.service.ts's own comment on why a data URI, not a real upload. */
  avatarUrl?: string;
}

export interface AuthService {
  login(email: string, password: string): Promise<ServiceResult<Session>>;
  register(input: RegisterInput): Promise<ServiceResult<RegistrationResult>>;
  logout(): Promise<void>;
  getSession(): Promise<ServiceResult<Session>>;
  switchCompany(companyId: UUID): Promise<ServiceResult<Session>>;
  /** Edits the caller's own account - name/phone/avatar. Never another user's, since the server
   *  resolves whose account this is from the session cookie, not any id this call could send. */
  updateProfile(patch: UserProfilePatch): Promise<ServiceResult<User>>;
}

/** Companies/users/memberships the real `/api/auth/*` backend (Phase 14) knows about but that
 *  every *other* mock service in this app (company.service.ts, catalog.service.ts, ...) still
 *  only ever reads from this localStorage-backed cache - those domains haven't been migrated to
 *  the database yet (section 34's staged plan; auth is stage 2, catalog/orders/etc. come later).
 *  `mirrorIntoRuntimeCache` below is the bridge: every successful auth call mirrors what the
 *  server returned into this cache, so a brand-new registration's company/user/membership is
 *  visible to the still-mock parts of the app exactly as if it had always been seed data. */
const RUNTIME_DATA_STORAGE_KEY = 'procurement.runtime-data.v1';

interface RuntimeData {
  companies: Company[];
  users: User[];
  companyUsers: CompanyUser[];
}

function readRuntimeData(): RuntimeData {
  if (typeof window === 'undefined') return { companies: [], users: [], companyUsers: [] };
  const raw = window.localStorage.getItem(RUNTIME_DATA_STORAGE_KEY);
  if (!raw) return { companies: [], users: [], companyUsers: [] };
  try {
    return JSON.parse(raw) as RuntimeData;
  } catch {
    return { companies: [], users: [], companyUsers: [] };
  }
}

function writeRuntimeData(data: RuntimeData) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RUNTIME_DATA_STORAGE_KEY, JSON.stringify(data));
}

function upsertById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values());
}

const COMPANY_OVERRIDE_KEY = 'procurement.company-profile-overrides.v1';

/** Overrides keyed by company id - lets company.service.ts's profile editor (section 10) edit
 *  a *seeded* demo company in place, the same seed+override pattern every other mutable mock
 *  resource in this app uses, rather than needing a company to have been runtime-registered
 *  before its profile fields could ever change. */
function readCompanyOverrides(): Record<UUID, Partial<Company>> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(COMPANY_OVERRIDE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, Partial<Company>>;
  } catch {
    return {};
  }
}

/** Applies a partial company-profile update - exported so company.service.ts can edit a
 *  company's profile without duplicating this module's storage/merge logic. */
export function writeCompanyProfileOverride(companyId: UUID, patch: Partial<Company>) {
  if (typeof window === 'undefined') return;
  const store = readCompanyOverrides();
  store[companyId] = { ...store[companyId], ...patch };
  window.localStorage.setItem(COMPANY_OVERRIDE_KEY, JSON.stringify(store));
}

/** Merges the static demo seed data with anything the real auth backend has told us about
 *  (registrations, and every login response's full company/user/membership list) and any
 *  profile edits made since. Exported so other mock services (company.service.ts, etc.) read
 *  the same merged view instead of only the static seed arrays. */
export function allCompanies(): Company[] {
  const overrides = readCompanyOverrides();
  return [...demoCompanies, ...readRuntimeData().companies].map((c) => (overrides[c.id] ? { ...c, ...overrides[c.id] } : c));
}

export function allUsers(): User[] {
  return upsertById(demoUsers, readRuntimeData().users);
}

export function allCompanyUsers(): CompanyUser[] {
  return upsertById(demoCompanyUsers, readRuntimeData().companyUsers);
}

/** The `/api/auth/*` responses' shape (see server/dto/session.ts#buildSessionPayload) - a
 *  superset of `Session` that also carries the full Company record for every membership, so the
 *  frontend's still-mock company/product/order pages can resolve a company by id without a
 *  separate `/api/companies/:id` round trip existing yet. */
interface ServerSessionPayload {
  user: User;
  memberships: CompanyUser[];
  activeCompanyId: string | null;
  companies: Company[];
  /** Set only when `companies` is empty - the status of the account's most recent membership
   *  (e.g. 'PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'), so login can explain *why* there's no
   *  usable workspace instead of a generic "not linked to any company" message. `null` means the
   *  account genuinely has no membership at all. Never reveals which company or any other
   *  account's data - just this caller's own, already-authenticated-with-a-correct-password,
   *  membership status. */
  membershipStatus?: string | null;
}

/** Mirrors a server session response into the local runtime cache (see RUNTIME_DATA_STORAGE_KEY's
 *  comment) so `allCompanies`/`allUsers`/`allCompanyUsers` immediately see it, then returns the
 *  plain `Session` shape every consumer of this service already expects. */
const demoCompanyIds = new Set(demoCompanies.map((c) => c.id));
const demoUserIds = new Set(demoUsers.map((u) => u.id));
const demoMembershipIds = new Set(demoCompanyUsers.map((m) => m.id));

/** A tailored explanation for why a correctly-authenticated login still has no usable workspace
 *  - the account's own membership status, not a generic dead end. `buildSessionPayload` (server)
 *  only ever includes ACTIVE memberships in `companies`, so this is the one place that status
 *  reaches the client at all. */
function membershipStatusMessage(status: string | null | undefined): string {
  switch (status) {
    case 'PENDING_APPROVAL':
      return 'Your registration is still awaiting approval from a platform administrator. You can sign back in once it has been reviewed.';
    case 'REJECTED':
      return 'Your registration was not approved. Contact your platform administrator if you believe this is a mistake.';
    case 'SUSPENDED':
      return 'Your account has been suspended. Contact your company administrator or platform support.';
    default:
      return 'This account is not linked to any company yet.';
  }
}

function mirrorIntoRuntimeCache(payload: ServerSessionPayload): Session | null {
  if (!payload.activeCompanyId) return null;

  // Only mirror records the static demo seed doesn't already have (i.e. genuinely new ones from
  // a real registration) - the seed arrays are richer for anything they already cover (full
  // addresses, credit terms, ...) than the DB's Phase-14 auth-only slice currently returns, so a
  // seeded account's data must keep coming from the seed, not a thinner duplicate that would
  // also double-count it in every `allCompanies()`/`allCompanyUsers()` consumer.
  const runtime = readRuntimeData();
  writeRuntimeData({
    companies: upsertById(runtime.companies, payload.companies.filter((c) => !demoCompanyIds.has(c.id))),
    users: upsertById(runtime.users, demoUserIds.has(payload.user.id) ? [] : [payload.user]),
    companyUsers: upsertById(runtime.companyUsers, payload.memberships.filter((m) => !demoMembershipIds.has(m.id))),
  });

  // `parentGroupId`/`parentGroupName` (Phase 19) come from a real server-side join
  // (server/dto/session.ts) that has nothing to do with the "richer seed data" reasoning above -
  // every company on this session, seeded or not, gets its real, current value written as a
  // profile override, so `allCompanies()` always reflects the group the server actually
  // resolved instead of silently keeping whatever (or nothing) the static seed had.
  for (const company of payload.companies) {
    writeCompanyProfileOverride(company.id, { parentGroupId: company.parentGroupId, parentGroupName: company.parentGroupName });
  }

  // Every company on this session that has one gets its real SupplierProfile primed into
  // catalog.service.ts's sync cache right now, from data already in hand - not lazily, the next
  // time some page happens to call listSuppliers(). getSupplierByCompanyId(activeCompany.id) is
  // how the supplier dashboard, Products & Inventory, and ~6 other pages resolve *their own*
  // profile; a cold cache there doesn't just show a blank name, it makes the whole page render
  // nothing (see primeSupplierCache's own comment).
  primeSupplierCache(payload.companies.flatMap((c) => (c.supplierProfile ? [c.supplierProfile] : [])));

  return { user: payload.user, memberships: payload.memberships, activeCompanyId: payload.activeCompanyId };
}

async function postJson<T>(path: string, body?: unknown): Promise<ServiceResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return fail('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return fail(String(response.status), data?.error ?? 'Something went wrong.', data?.fieldErrors);
  }
  return ok(data as T);
}

/**
 * Calls the real `/api/auth/*` backend (Phase 14) - session state itself now lives entirely in
 * a server-verified, httpOnly-cookie-backed session (see server/auth/session.ts), never in
 * localStorage. The `AuthService` interface and `Session` shape are the contract every consumer
 * (useAuth, layouts, guards) depends on; this class satisfying it unchanged is what let every
 * page that calls `useAuth()` keep working without modification once auth moved server-side.
 */
class ApiAuthService implements AuthService {
  async login(email: string, password: string): Promise<ServiceResult<Session>> {
    const result = await postJson<ServerSessionPayload>('/api/auth/login', { email, password });
    if (!result.ok) return result;
    const session = mirrorIntoRuntimeCache(result.data);
    if (!session) return fail('NO_COMPANY', membershipStatusMessage(result.data.membershipStatus));
    return ok(session);
  }

  async register(input: RegisterInput): Promise<ServiceResult<RegistrationResult>> {
    // Unlike login/switchCompany, a brand-new registration is never immediately active (Phase
    // 26's PENDING_APPROVAL gate) - there's no Session to mirror into the runtime cache here,
    // just a pending-approval acknowledgement to hand back as-is.
    return postJson<RegistrationResult>('/api/auth/register', input);
  }

  async logout(): Promise<void> {
    await postJson('/api/auth/logout');
  }

  async getSession(): Promise<ServiceResult<Session>> {
    let response: Response;
    try {
      response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    } catch {
      return fail('NETWORK_ERROR', 'Could not reach the server.');
    }
    const data = await response.json().catch(() => null);
    if (!data) return fail('NO_SESSION', 'Not signed in.');
    const session = mirrorIntoRuntimeCache(data as ServerSessionPayload);
    if (!session) return fail('NO_SESSION', 'Not signed in.');
    return ok(session);
  }

  async switchCompany(companyId: string): Promise<ServiceResult<Session>> {
    const result = await postJson<ServerSessionPayload>('/api/auth/switch-company', { companyId });
    if (!result.ok) return result;
    const session = mirrorIntoRuntimeCache(result.data);
    if (!session) return fail('FORBIDDEN', 'You are not a member of that company.');
    return ok(session);
  }

  async updateProfile(patch: UserProfilePatch): Promise<ServiceResult<User>> {
    const result = await apiRequest<User>('/api/users/me', { method: 'PATCH', body: JSON.stringify(patch) });
    if (result.ok) {
      // Mirror the confirmed user back into the runtime cache other still-mock services read
      // (allUsers()) - the same "mirror what the server just confirmed" pattern
      // mirrorIntoRuntimeCache uses for login/session/switchCompany, just for a single user
      // instead of a whole session.
      const runtime = readRuntimeData();
      writeRuntimeData({ ...runtime, users: upsertById(runtime.users, [result.data]) });
    }
    return result;
  }
}

export const authService: AuthService = new ApiAuthService();

export function activeCompanyOf(session: Session): Company | undefined {
  return allCompanies().find((c) => c.id === session.activeCompanyId);
}

export function activeMembershipOf(session: Session): CompanyUser | undefined {
  return session.memberships.find((m) => m.companyId === session.activeCompanyId);
}

export function activeWorkspaceOf(session: Session): Workspace {
  const membership = activeMembershipOf(session);
  return membership ? workspaceForRole(membership.role) : 'buyer';
}

export function companiesOf(session: Session): Company[] {
  return allCompanies().filter((c) => session.memberships.some((m) => m.companyId === c.id));
}
