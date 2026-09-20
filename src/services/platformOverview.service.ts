import { apiRequest } from './base';
import type { ServiceResult, UUID } from '@/types/common';
import type { Role } from '@/config/rbac';
import type { AuditEntry } from '@/types/common';

export interface CountBreakdown {
  total: number;
  active: number;
  suspended: number;
}

export interface SupplierBreakdown {
  total: number;
  verified: number;
  pendingVerification: number;
  suspended: number;
}

export interface PendingApprovalPreview {
  userId: UUID;
  userName: string;
  companyId: UUID;
  companyName: string;
  submittedAt: string;
}

export interface ApprovalsOverview {
  total: number;
  items: PendingApprovalPreview[];
}

export interface SystemStatus {
  database: 'healthy' | 'unavailable';
  api: 'healthy';
}

export interface PlatformOverview {
  role: Role;
  companies?: CountBreakdown;
  suppliers?: SupplierBreakdown;
  users?: CountBreakdown;
  approvals?: ApprovalsOverview;
  activity?: AuditEntry[];
  systemStatus: SystemStatus;
}

/** The Platform Command Center dashboard's one data fetch - GET /api/admin/overview. See the
 *  server-side platformOverview.service.ts for exactly which sections require which permission;
 *  a section absent from the response means the caller's role doesn't hold that permission, not
 *  a loading/error state. */
export const platformOverviewService = {
  getOverview(): Promise<ServiceResult<PlatformOverview>> {
    return apiRequest<PlatformOverview>('/api/admin/overview');
  },
};
