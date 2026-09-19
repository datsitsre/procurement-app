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
}

async function resolveTenant(activeCompanyId: string | null, userId: string): Promise<{ tenant: TenantContext; role: Role | undefined }> {
  if (!activeCompanyId) return { tenant: {}, role: undefined };

  const membership = await db.companyMembership.findUnique({
    where: { companyId_userId: { companyId: activeCompanyId, userId } },
  });
  // The session names a company the caller is no longer (or never was) a member of - treat as
  // "no tenant" rather than trusting the stale id, the same fail-closed behavior ownsRecord uses.
  if (!membership || membership.status !== 'ACTIVE') return { tenant: {}, role: undefined };

  // Only the exceptional, system-wide roles receive the ownsRecord() tenant-isolation bypass -
  // PLATFORM_MANAGER is a real platform role (it holds PLATFORM_SETTINGS_MANAGE etc.) but is
  // deliberately NOT in this list, so it can never read/write another company's transactional
  // data no matter what route it calls. See rbac.ts's CROSS_TENANT_ROLES for the single source
  // of truth this mirrors.
  if (CROSS_TENANT_ROLES.includes(membership.role as Role)) {
    return { tenant: { isPlatformAdmin: true }, role: membership.role as Role };
  }
  if (PLATFORM_ROLES.includes(membership.role as Role)) {
    // A platform role that isn't cross-tenant (PLATFORM_MANAGER) - no companyId/supplierId,
    // no isPlatformAdmin bypass. Route-level permission checks (PLATFORM_SETTINGS_MANAGE, etc.)
    // are this role's entire authorization story.
    return { tenant: {}, role: membership.role as Role };
  }

  const company = await db.company.findUnique({
    where: { id: activeCompanyId },
    select: { isSupplier: true, supplierProfile: { select: { id: true } } },
  });

  if (company?.isSupplier && company.supplierProfile) {
    return { tenant: { supplierId: company.supplierProfile.id }, role: membership.role as Role };
  }

  return { tenant: { companyId: activeCompanyId }, role: membership.role as Role };
}

/** Resolves the caller's auth context from the request's session cookie, or null if there is no
 *  valid session. Every protected route handler must check this before doing anything else -
 *  see requireAuth() for the common "401 if missing" wrapper most routes actually want. */
export async function getAuthContext(request: NextRequest): Promise<AuthContext | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  const { tenant, role } = await resolveTenant(session.activeCompanyId, session.userId);

  return {
    sessionId: session.sessionId,
    userId: session.userId,
    userName: session.userName,
    userEmail: session.userEmail,
    role,
    tenant,
    activeCompanyId: session.activeCompanyId,
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
