import type { ServiceError, ServiceResult, TenantContext } from '@/types/common';
import { hasPermission, type Permission, type Role } from '@/config/rbac';

/** Simulates real network latency so loading states (skeletons, disabled buttons) are
 *  actually exercised during development instead of resolving instantly. */
export function delay(ms = 350): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T>(code: string, message: string, fieldErrors?: Record<string, string>): ServiceResult<T> {
  return { ok: false, error: { code, message, fieldErrors } as ServiceError };
}

/**
 * True if `caller` is allowed to see a record owned by `recordCompanyId` and/or
 * `recordSupplierId` - a platform admin may see anything, a buyer only their own company's
 * records, a supplier only their own supplier id's records. Pass whichever owner field(s) the
 * record actually has; an `undefined` field is never matched.
 */
export function ownsRecord(caller: TenantContext, recordCompanyId?: string, recordSupplierId?: string): boolean {
  if (caller.isPlatformAdmin) return true;
  if (caller.companyId !== undefined && recordCompanyId === caller.companyId) return true;
  if (caller.supplierId !== undefined && recordSupplierId === caller.supplierId) return true;
  return false;
}

/** A deliberately generic "not found" for a failed ownership check - never a distinct
 *  "forbidden", so a probing request can't tell an ID that exists-but-isn't-yours apart from
 *  one that doesn't exist at all (the standard IDOR mitigation). */
export function failNotFound<T>(message: string): ServiceResult<T> {
  return fail('NOT_FOUND', message);
}

/**
 * Every mock service method that performs a write re-checks the caller's permission here
 * before proceeding - not because the frontend is a security boundary (it never is, see
 * section 37/46), but so the *pattern* of "the backend rejects unauthorized writes" is
 * present now and a real API only has to keep enforcing it, not introduce it.
 */
export function assertPermission(role: Role, permission: Permission): ServiceError | null {
  if (hasPermission(role, permission)) return null;
  return {
    code: 'FORBIDDEN',
    message: `Your role does not have the "${permission}" permission.`,
  };
}

/**
 * Shared client-side fetch wrapper for services that have been migrated to a real `/api/*`
 * backend (Phase 14) - same-origin cookies (the httpOnly session), JSON in/out, and a uniform
 * `ServiceResult` mapping so a migrated service's methods keep returning exactly what its
 * mock predecessor did. Auth failures/validation errors/business-rule rejections all arrive as
 * `{ error, fieldErrors? }` from the API and get normalized here into `fail(...)`.
 */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<ServiceResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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
