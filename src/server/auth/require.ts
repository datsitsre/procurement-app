import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { ownsRecord } from '@/services/base';
import { hasPermission, type Permission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden, type AuthContext } from './context';
import { isSameOrigin } from './csrf';

export type RequireResult = { ok: true; auth: AuthContext } | { ok: false; response: NextResponse };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The API-route counterpart to every mock service's `assertPermission(callerRole, permission)`
 * + `ownsRecord(caller, companyId)` pair (section 3's Route → auth() → assertPermission()
 * layering, made real). Every route handler that acts on one company's data should call this
 * first and return its `response` immediately if `ok` is false - never proceed to touch the
 * database on a request that fails either check.
 *
 * `companyId` here is always the value from the URL path, but "the caller asked for this
 * company" is never sufficient by itself - `ownsRecord` re-derives whether the *authenticated*
 * caller's own tenant actually is this company from the verified session, exactly the
 * "never trust a client-supplied company id" rule in section 6.
 *
 * Also applies the same same-origin (CSRF) check every `/api/auth/*` mutation uses, for any
 * non-GET method - centralized here so every company route gets it automatically instead of
 * each route file needing to remember to call it.
 */
async function requireAuthAndPermission(request: NextRequest, permission?: Permission): Promise<RequireResult> {
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 }) };
  }

  const auth = await getAuthContext(request);
  if (!auth) return { ok: false, response: unauthorized() };

  if (permission && (!auth.role || !hasPermission(auth.role, permission))) {
    return { ok: false, response: forbidden() };
  }

  return { ok: true, auth };
}

export async function requireCompanyAccess(
  request: NextRequest,
  companyId: string,
  permission?: Permission,
): Promise<RequireResult> {
  const result = await requireAuthAndPermission(request, permission);
  if (!result.ok) return result;

  // Deliberately the same generic 404 an IDOR probe would get for a nonexistent id - never a
  // distinct "forbidden" that would confirm the company exists but isn't theirs.
  if (!ownsRecord(result.auth.tenant, companyId)) {
    return { ok: false, response: NextResponse.json({ error: 'That company could not be found.' }, { status: 404 }) };
  }

  return result;
}

/** The supplier-side counterpart to requireCompanyAccess - `supplierId` is a SupplierProfile.id
 *  (not a Company.id), matching every product/RFQ/order/invoice's own `supplierId` field
 *  throughout this app. */
export async function requireSupplierAccess(
  request: NextRequest,
  supplierId: string,
  permission?: Permission,
): Promise<RequireResult> {
  const result = await requireAuthAndPermission(request, permission);
  if (!result.ok) return result;

  if (!ownsRecord(result.auth.tenant, undefined, supplierId)) {
    return { ok: false, response: NextResponse.json({ error: 'That product could not be found.' }, { status: 404 }) };
  }

  return result;
}

/** For routes that need authentication + a permission but no per-record tenant scoping - the
 *  platform-admin product moderation queue, for example, where PLATFORM_MANAGE itself is the
 *  whole authorization story (see assertPermission's mock equivalent for the same routes). */
export async function requireAuthenticated(request: NextRequest, permission?: Permission): Promise<RequireResult> {
  return requireAuthAndPermission(request, permission);
}
