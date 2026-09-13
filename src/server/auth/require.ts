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
export async function requireCompanyAccess(
  request: NextRequest,
  companyId: string,
  permission?: Permission,
): Promise<RequireResult> {
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 }) };
  }

  const auth = await getAuthContext(request);
  if (!auth) return { ok: false, response: unauthorized() };

  if (permission && (!auth.role || !hasPermission(auth.role, permission))) {
    return { ok: false, response: forbidden() };
  }

  // Deliberately the same generic 404 an IDOR probe would get for a nonexistent id - never a
  // distinct "forbidden" that would confirm the company exists but isn't theirs.
  if (!ownsRecord(auth.tenant, companyId)) {
    return { ok: false, response: NextResponse.json({ error: 'That company could not be found.' }, { status: 404 }) };
  }

  return { ok: true, auth };
}
