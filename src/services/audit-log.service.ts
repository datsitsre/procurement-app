import { apiRequest } from './base';
import type { AuditEntry, CursorPage, ServiceResult } from '@/types/common';

export interface AuditLogService {
  /** Cursor-paginated (Phase 17) - pass the previous call's `nextCursor` to fetch the next page. */
  listEntries(cursor?: string | null, pageSize?: number): Promise<ServiceResult<CursorPage<AuditEntry>>>;
}

/**
 * Calls the real, platform-admin-only `GET /api/audit-log` (Phase 17, section 12) - replaces a
 * prior `localStorage`/demo-data mock that never reflected the real `AuditLog` table other
 * services have been writing to all along (see PHASE17_AUDIT.md finding 4).
 */
class ApiAuditLogService implements AuditLogService {
  async listEntries(cursor?: string | null, pageSize = 25): Promise<ServiceResult<CursorPage<AuditEntry>>> {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (cursor) params.set('cursor', cursor);
    return apiRequest<CursorPage<AuditEntry>>(`/api/audit-log?${params.toString()}`);
  }
}

export const auditLogService: AuditLogService = new ApiAuditLogService();
