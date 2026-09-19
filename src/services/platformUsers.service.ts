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

export const platformUsersService = {
  listPlatformUsers(): Promise<ServiceResult<PlatformUserRow[]>> {
    return apiRequest<PlatformUserRow[]>('/api/admin/platform/users');
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
