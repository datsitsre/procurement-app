import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { CROSS_TENANT_ROLES, PLATFORM_ROLES, type Role } from '@/config/rbac';
import type { TenantContext } from '@/types/common';
import { SESSION_COOKIE_NAME, verifySessionToken } from './session';

/**
 * Everything a route handler needs to authorize a request, resolved from the session cookie
 * alone - never from anything the client asserts in the request body/query. This is the server
 * counterpart to hooks/useAuth.tsx's `useTenantContext`: same shape (`TenantContext`), same
 * rule (companyId/supplierId/isPlatformAdmin are derived, never client-supplied), but backed by
 * a real session + database lookup instead of a `localStorage` blob the browser could edit.
 */
export interface AuthContext {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  /** The role the user holds in `tenant`'s company - undefined if they have no active company
   *  selected yet (e.g. straight after registering, before joining/creating one). */
  role: Role | undefined;
  tenant: TenantContext;
  /** The raw `Session.activeCompanyId` this tenant was resolved from - distinct from
   *  `tenant.companyId`, which is empty when the active company is actually a supplier or the
   *  platform account. Session-shaped API responses (session/switch-company) need this raw id,
   *  not the collapsed tenant view. */
  activeCompanyId: string | null;
  /** True only when the caller's own *buyer* company (never a supplier - see resolveTenant's own
   *  comment) has Company.status === SUSPENDED (Phase 28 follow-up - Company Organization
   *  Management). `tenant` is already fail-closed (`{}`) in this case, exactly like a non-ACTIVE
   *  membership - every route is already blocked via the existing ownsRecord mismatch path with
   *  no further changes needed. This flag exists only so requireCompanyAccess (the shared layer
   *  most company-scoped routes already call through) can return a clear, specific 403 instead
   *  of the generic "not found" a stale/foreign tenant id gets - see its own comment. */
  companySuspended: boolean;
}

async function resolveTenant(
  activeCompanyId: string | null,
  userId: string,
): Promise<{ tenant: TenantContext; role: Role | undefined; companySuspended: boolean }> {
  if (!activeCompanyId) return { tenant: {}, role: undefined, companySuspended: false };

  const membership = await db.companyMembership.findUnique({
    where: { companyId_userId: { companyId: activeCompanyId, userId } },
  });
  // The session names a company the caller is no longer (or never was) a member of - treat as
  // "no tenant" rather than trusting the stale id, the same fail-closed behavior ownsRecord uses.
  if (!membership || membership.status !== 'ACTIVE') return { tenant: {}, role: undefined, companySuspended: false };

  // Only the exceptional, system-wide roles receive the ownsRecord() tenant-isolation bypass -
  // PLATFORM_MANAGER is a real platform role (it holds PLATFORM_SETTINGS_MANAGE etc.) but is
  // deliberately NOT in this list, so it can never read/write another company's transactional
  // data no matter what route it calls. See rbac.ts's CROSS_TENANT_ROLES for the single source
  // of truth this mirrors. A platform admin's own session never reaches the suspension check
  // below - it belongs to their own platform-type company, resolved here, not the company they
  // might be administering (which they reach via the isPlatformAdmin bypass on a *different*
  // company's records, never through their own tenant resolution).
  if (CROSS_TENANT_ROLES.includes(membership.role as Role)) {
    return { tenant: { isPlatformAdmin: true }, role: membership.role as Role, companySuspended: false };
  }
  if (PLATFORM_ROLES.includes(membership.role as Role)) {
    // A platform role that isn't cross-tenant (PLATFORM_MANAGER) - no companyId/supplierId,
    // no isPlatformAdmin bypass. Route-level permission checks (PLATFORM_SETTINGS_MANAGE, etc.)
    // are this role's entire authorization story.
    return { tenant: {}, role: membership.role as Role, companySuspended: false };
  }

  const company = await db.company.findUnique({
    where: { id: activeCompanyId },
    select: { isSupplier: true, status: true, supplierProfile: { select: { id: true } } },
  });

  if (company?.isSupplier && company.supplierProfile) {
    // Suppliers keep their own, pre-existing lifecycle (SupplierProfile.verification) -
    // Company.status suspension deliberately never applies here (section 10's own instruction:
    // "supplier lifecycle remains based on the existing supplier verification/suspension
    // implementation"). The admin suspend/activate routes themselves also refuse to act on a
    // supplier-type company - see their own comment.
    return { tenant: { supplierId: company.supplierProfile.id }, role: membership.role as Role, companySuspended: false };
  }

  if (company?.status === 'SUSPENDED') {
    // Fail closed exactly like a non-ACTIVE membership above - every company-scoped route (both
    // the shared requireCompanyAccess wrapper and the handful of routes that fetch a record
    // first and check ownsRecord manually, e.g. orders/[id]) is blocked with no further changes
    // needed anywhere. `companySuspended: true` lets requireCompanyAccess surface a clearer,
    // specific message than the generic tenant-mismatch one on top of this.
    return { tenant: {}, role: undefined, companySuspended: true };
  }

  return { tenant: { companyId: activeCompanyId }, role: membership.role as Role, companySuspended: false };
}

/** Resolves the caller's auth context from the request's session cookie, or null if there is no
 *  valid session. Every protected route handler must check this before doing anything else -
 *  see requireAuth() for the common "401 if missing" wrapper most routes actually want. */
export async function getAuthContext(request: NextRequest): Promise<AuthContext | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  const { tenant, role, companySuspended } = await resolveTenant(session.activeCompanyId, session.userId);

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    userName: session.userName,
    userEmail: session.userEmail,
    role,
    tenant,
    activeCompanyId: session.activeCompanyId,
    companySuspended,
  };
}

/** Standard "safe" 401 - never reveals whether a session existed and expired vs. never existed
 *  at all (section 21/22's "do not leak internals" applies to auth state too). */
export function unauthorized() {
  return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
}

export function forbidden(message = 'You do not have permission to perform this action.') {
  return NextResponse.json({ error: message }, { status: 403 });
}
