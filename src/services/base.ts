import type { ServiceError, ServiceResult } from '@/types/common';
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
