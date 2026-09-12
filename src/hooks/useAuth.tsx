'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  authService,
  activeCompanyOf,
  activeMembershipOf,
  activeWorkspaceOf,
  type RegisterInput,
  type Session,
} from '@/services/auth.service';
import { hasPermission, type Permission } from '@/config/rbac';
import type { ServiceError } from '@/types/common';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<ServiceError | null>;
  register: (input: RegisterInput) => Promise<ServiceError | null>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<ServiceError | null>;
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
    const result = await authService.register(input);
    if (result.ok) {
      setSession(result.data);
      return null;
    }
    return result.error;
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

  const can = useCallback(
    (permission: Permission) => {
      if (!session) return false;
      const membership = activeMembershipOf(session);
      return membership ? hasPermission(membership.role, permission) : false;
    },
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, login, register, logout, switchCompany, can }),
    [session, loading, login, register, logout, switchCompany, can],
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
