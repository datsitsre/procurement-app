import { apiRequest } from './base';
import type { AuditEntry, CursorPage, ServiceResult } from '@/types/common';

export interface AuditLogService {
  /** Cursor-paginated (Phase 17) - pass the previous call's `nextCursor` to fetch the next page.
   *  Platform-wide - PLATFORM_AUDIT_VIEW only (see /api/audit-log's own scoping by role).
   *  `companyId` (Phase 28) narrows the same platform-wide feed to one company - used by the
   *  Company Detail page's Activity tab, which has no other way to reach a specific company's
   *  entries (the tenant-scoped /api/companies/[companyId]/audit-log requires AUDIT_VIEW, a
   *  company-role permission neither platform role holds - see this phase's own report). */
  listEntries(cursor?: string | null, pageSize?: number, companyId?: string): Promise<ServiceResult<CursorPage<AuditEntry>>>;
  /** A single company's own audit trail (Phase 26 - closes the "company users have no audit log
   *  page at all" gap even though /api/companies/[companyId]/audit-log has existed since the
   *  access-control audit). Tenant-checked server-side the same way every other
   *  companies/[companyId]/* route is - this call can never see another company's entries. */
  listCompanyEntries(companyId: string, cursor?: string | null, pageSize?: number): Promise<ServiceResult<CursorPage<AuditEntry>>>;
}

/**
 * Calls the real, platform-admin-only `GET /api/audit-log` (Phase 17, section 12) - replaces a
 * prior `localStorage`/demo-data mock that never reflected the real `AuditLog` table other
 * services have been writing to all along (see PHASE17_AUDIT.md finding 4).
 */
class ApiAuditLogService implements AuditLogService {
  async listEntries(cursor?: string | null, pageSize = 25, companyId?: string): Promise<ServiceResult<CursorPage<AuditEntry>>> {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (cursor) params.set('cursor', cursor);
    if (companyId) params.set('companyId', companyId);
    return apiRequest<CursorPage<AuditEntry>>(`/api/audit-log?${params.toString()}`);
  }

  async listCompanyEntries(companyId: string, cursor?: string | null, pageSize = 25): Promise<ServiceResult<CursorPage<AuditEntry>>> {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (cursor) params.set('cursor', cursor);
    return apiRequest<CursorPage<AuditEntry>>(`/api/companies/${companyId}/audit-log?${params.toString()}`);
  }
}

export const auditLogService: AuditLogService = new ApiAuditLogService();
