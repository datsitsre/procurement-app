import { delay, fail, ok } from './base';
import { demoCompanies, demoCompanyUsers, demoUsers } from '@/lib/demo-data/companies';
import type { ServiceResult, UUID, CountryCode, CurrencyCode } from '@/types/common';
import type { Company, CompanyUser, User } from '@/types/company';
import { Role, workspaceForRole, type Workspace } from '@/config/rbac';

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

export interface AuthService {
  login(email: string, password: string): Promise<ServiceResult<Session>>;
  register(input: RegisterInput): Promise<ServiceResult<Session>>;
  logout(): Promise<void>;
  getSession(): Promise<ServiceResult<Session>>;
  switchCompany(companyId: UUID): Promise<ServiceResult<Session>>;
}

const SESSION_STORAGE_KEY = 'procurement.session.v1';
/** Companies/users/memberships created at runtime via registration - kept separate from the
 *  static demo seed data and merged with it on read, so a page reload doesn't lose a newly
 *  registered company (until a real backend replaces this persistence entirely). */
const RUNTIME_DATA_STORAGE_KEY = 'procurement.runtime-data.v1';
/** email -> password, for every account (seed and runtime-registered) - kept separate from
 *  the User record itself, the way a real backend would never return a password hash as part
 *  of a user object. Plaintext here only because this is a mock; a real AuthService would
 *  never store or compare passwords client-side at all. */
const CREDENTIALS_STORAGE_KEY = 'procurement.credentials.v1';

/** All seeded demo accounts (section 65) share this password. */
const DEMO_PASSWORD = 'password123';

interface RuntimeData {
  companies: Company[];
  users: User[];
  companyUsers: CompanyUser[];
}

function readCredentials(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCredential(email: string, password: string) {
  if (typeof window === 'undefined') return;
  const creds = readCredentials();
  creds[email.toLowerCase()] = password;
  window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(creds));
}

function passwordFor(email: string): string {
  return readCredentials()[email.toLowerCase()] ?? DEMO_PASSWORD;
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

/** Merges the static demo seed data with anything created at runtime (e.g. via registration).
 *  Exported so other mock services (company.service.ts, etc.) read the same merged view
 *  instead of only the static seed arrays - otherwise a newly registered company's own data
 *  would be invisible to every service except this one. */
export function allCompanies(): Company[] {
  return [...demoCompanies, ...readRuntimeData().companies];
}

export function allUsers(): User[] {
  return [...demoUsers, ...readRuntimeData().users];
}

export function allCompanyUsers(): CompanyUser[] {
  return [...demoCompanyUsers, ...readRuntimeData().companyUsers];
}

function findUserByEmail(email: string): User | undefined {
  return allUsers().find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
}

function membershipsFor(userId: UUID): CompanyUser[] {
  return allCompanyUsers().filter((cu) => cu.userId === userId && cu.status === 'ACTIVE');
}

function readStoredSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function writeStoredSession(session: Session | null) {
  if (typeof window === 'undefined') return;
  if (session) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function newId(prefix: string): UUID {
  return `${prefix}-${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now()}`;
}

/**
 * Mock implementation backed by localStorage + the in-memory demo dataset. Swap this file
 * for one that calls a real `/api/auth/*` backend later - the `AuthService` interface and
 * the `Session` shape are the contract every consumer (useAuth, layouts, guards) depends on,
 * not this class. Real IDs would be server-generated UUIDs rather than crypto.randomUUID().
 */
class MockAuthService implements AuthService {
  async login(email: string, password: string): Promise<ServiceResult<Session>> {
    await delay();
    const user = findUserByEmail(email);
    if (!user || password !== passwordFor(email)) {
      return fail('INVALID_CREDENTIALS', 'That email or password is incorrect.');
    }
    const memberships = membershipsFor(user.id);
    if (memberships.length === 0) {
      return fail('NO_COMPANY', 'This account is not linked to any company yet.');
    }
    const session: Session = { user, memberships, activeCompanyId: memberships[0].companyId };
    writeStoredSession(session);
    return ok(session);
  }

  async register(input: RegisterInput): Promise<ServiceResult<Session>> {
    await delay(500);

    if (findUserByEmail(input.email)) {
      return fail('EMAIL_TAKEN', 'An account with that email already exists.', { email: 'Already registered' });
    }
    if (input.password.length < 8) {
      return fail('WEAK_PASSWORD', 'Password must be at least 8 characters.', {
        password: 'Must be at least 8 characters',
      });
    }

    const runtime = readRuntimeData();

    const company: Company = {
      id: newId('company'),
      name: input.companyName,
      country: input.country,
      currency: input.currency,
      addresses: [],
      creditTerms: 'PREPAID',
      isBuyer: true,
      isSupplier: false,
      createdAt: new Date().toISOString(),
    };
    const user: User = {
      id: newId('user'),
      name: input.fullName,
      email: input.email,
      createdAt: new Date().toISOString(),
    };
    const membership: CompanyUser = {
      id: newId('cu'),
      companyId: company.id,
      userId: user.id,
      role: Role.OWNER,
      status: 'ACTIVE',
      joinedAt: new Date().toISOString(),
    };

    writeRuntimeData({
      companies: [...runtime.companies, company],
      users: [...runtime.users, user],
      companyUsers: [...runtime.companyUsers, membership],
    });
    writeCredential(input.email, input.password);

    const session: Session = { user, memberships: [membership], activeCompanyId: company.id };
    writeStoredSession(session);
    return ok(session);
  }

  async logout(): Promise<void> {
    await delay(150);
    writeStoredSession(null);
  }

  async getSession(): Promise<ServiceResult<Session>> {
    await delay(150);
    const session = readStoredSession();
    if (!session) return fail('NO_SESSION', 'Not signed in.');
    return ok(session);
  }

  async switchCompany(companyId: string): Promise<ServiceResult<Session>> {
    await delay(200);
    const session = readStoredSession();
    if (!session) return fail('NO_SESSION', 'Not signed in.');
    const stillMember = session.memberships.some((m) => m.companyId === companyId);
    if (!stillMember) {
      return fail('FORBIDDEN', 'You are not a member of that company.');
    }
    const next: Session = { ...session, activeCompanyId: companyId };
    writeStoredSession(next);
    return ok(next);
  }
}

export const authService: AuthService = new MockAuthService();

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
