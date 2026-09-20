'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  authService,
  activeCompanyOf,
  activeMembershipOf,
  activeWorkspaceOf,
  type RegisterInput,
  type RegistrationResult,
  type Session,
  type UserProfilePatch,
} from '@/services/auth.service';
import { hasPermission, type Permission } from '@/config/rbac';
import type { ServiceError, ServiceResult, TenantContext } from '@/types/common';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<ServiceError | null>;
  /** Unlike login, a successful call never signs anyone in - a brand-new registration is always
   *  PENDING_APPROVAL (Phase 26), so the caller gets the full result back to show a pending-
   *  approval state, not just a success/failure signal. */
  register: (input: RegisterInput) => Promise<ServiceResult<RegistrationResult>>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<ServiceError | null>;
  updateProfile: (patch: UserProfilePatch) => Promise<ServiceError | null>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    authService.getSession().then((result) => {
      if (cancelled) return;
      setSession(result.ok ? result.data : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authService.login(email, password);
    if (result.ok) {
      setSession(result.data);
      return null;
    }
    return result.error;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    return authService.register(input);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setSession(null);
  }, []);

  const switchCompany = useCallback(async (companyId: string) => {
    const result = await authService.switchCompany(companyId);
    if (result.ok) {
      setSession(result.data);
      return null;
    }
    return result.error;
  }, []);

  const updateProfile = useCallback(async (patch: UserProfilePatch) => {
    const result = await authService.updateProfile(patch);
    if (result.ok) {
      setSession((current) => (current ? { ...current, user: result.data } : current));
      return null;
    }
    return result.error;
  }, []);

  const can = useCallback(
    (permission: Permission) => {
      if (!session) return false;
      const membership = activeMembershipOf(session);
      return membership ? hasPermission(membership.role, permission) : false;
    },
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, login, register, logout, switchCompany, updateProfile, can }),
    [session, loading, login, register, logout, switchCompany, updateProfile, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>');
  return ctx;
}

/** Convenience selectors most components actually want, rather than re-deriving them from
 *  the raw session everywhere. */
export function useActiveCompany() {
  const { session } = useAuth();
  return session ? activeCompanyOf(session) : undefined;
}

export function useActiveMembership() {
  const { session } = useAuth();
  return session ? activeMembershipOf(session) : undefined;
}

export function useWorkspace() {
  const { session } = useAuth();
  return session ? activeWorkspaceOf(session) : 'buyer';
}

/**
 * The current caller's tenant identity, for services' `ownsRecord` ownership checks (section
 * 9.2) - every page that fetches an entity by a URL path segment (an order id, an RFQ id, an
 * invoice id, ...) must pass this through to the service call instead of trusting the id alone.
 */
export function useTenantContext(): TenantContext {
  const company = useActiveCompany();
  const workspace = useWorkspace();

  return useMemo(() => {
    if (workspace === 'platform') return { isPlatformAdmin: true };
    if (!company) return {};
    // Read directly off the session (company.supplierProfileId), not an async catalog lookup -
    // this resolves synchronously and is never stale, the same join
    // server/auth/context.ts's resolveTenant already does server-side from the session alone.
    if (workspace === 'supplier') return { supplierId: company.supplierProfileId };
    return { companyId: company.id };
  }, [company, workspace]);
}
