import { apiRequest } from './base';
import type { Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';

export interface PlatformUserRow {
  userId: UUID;
  userName: string;
  userEmail: string;
  companyId: UUID;
  companyName: string;
  role: Role;
  status: string;
  joinedAt?: string;
  createdAt: string;
}

/** See server/services/platformUsers.service.ts's own comment for exactly which fields this is
 *  and isn't - `primary*` reflects one representative membership, the full picture lives on
 *  `UserDetail` below. */
export interface UserDirectoryRow {
  id: UUID;
  name: string;
  email: string;
  phone?: string;
  createdAt: string;
  membershipCount: number;
  distinctRoleCount: number;
  primaryRole?: Role;
  primaryStatus?: string;
  primaryCompanyId?: UUID;
  primaryCompanyName?: string;
}

export interface UserDirectoryFilters {
  search?: string;
  role?: Role;
  status?: string;
  companyId?: UUID;
  sort?: 'name' | 'email' | 'created';
}

export interface UserMembershipDetail {
  companyId: UUID;
  companyName: string;
  isSupplier: boolean;
  isPlatform: boolean;
  role: Role;
  status: string;
  department?: string;
  invitedAt?: string;
  joinedAt?: string;
}

export interface UserDetail {
  id: UUID;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  createdAt: string;
  memberships: UserMembershipDetail[];
}

export const platformUsersService = {
  listPlatformUsers(): Promise<ServiceResult<PlatformUserRow[]>> {
    return apiRequest<PlatformUserRow[]>('/api/admin/platform/users');
  },

  /** GET /api/admin/users - the broader "every user, every company" directory, distinct from
   *  `listPlatformUsers` above (see that route's own comment). */
  listAllUsers(filters: UserDirectoryFilters = {}): Promise<ServiceResult<UserDirectoryRow[]>> {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.role) params.set('role', filters.role);
    if (filters.status) params.set('status', filters.status);
    if (filters.companyId) params.set('companyId', filters.companyId);
    if (filters.sort) params.set('sort', filters.sort);
    const qs = params.toString();
    return apiRequest<UserDirectoryRow[]>(`/api/admin/users${qs ? `?${qs}` : ''}`);
  },

  /** GET /api/admin/users/[userId] - one user's full cross-company membership picture. */
  getUserDetail(userId: UUID): Promise<ServiceResult<UserDetail>> {
    return apiRequest<UserDetail>(`/api/admin/users/${userId}`);
  },

  decideRegistration(userId: UUID, companyId: UUID, decision: 'APPROVED' | 'REJECTED') {
    return apiRequest<{ userId: UUID; companyId: UUID; status: string }>(`/api/admin/platform/users/${userId}/registration`, {
      method: 'PATCH',
      body: JSON.stringify({ companyId, decision }),
    });
  },

  setMembershipStatus(userId: UUID, companyId: UUID, status: 'SUSPENDED' | 'ACTIVE') {
    return apiRequest<{ userId: UUID; companyId: UUID; status: string }>(`/api/admin/platform/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ companyId, status }),
    });
  },

  changePlatformRole(userId: UUID, companyId: UUID, role: 'PLATFORM_MANAGER' | 'PLATFORM_SUPER_ADMIN') {
    return apiRequest<{ userId: UUID; companyId: UUID; role: Role }>(`/api/admin/platform/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ companyId, role }),
    });
  },
};
