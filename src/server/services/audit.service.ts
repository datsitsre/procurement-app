import 'server-only';
import { db } from '@/server/db';
import { ok } from '@/services/base';
import { toCursorPage, type CursorPaginationParams } from '@/server/pagination';
import type { AuditEntry, CursorPage, ServiceResult } from '@/types/common';

export interface NewAuditEntry {
  actorId?: string;
  actorName: string;
  companyId?: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
}

/** Records one audit-trail entry (section 20/48/62) - the server-side counterpart to
 *  audit-log.service.ts's mock. Never logs secrets, payment credentials, or passwords - callers
 *  pass only safe, already-DTO-shaped before/after values. Not permission-gated itself, the same
 *  way the mock isn't: it's called *after* the caller's own assertPermission/ownsRecord check
 *  has already passed, the way a real audit middleware sits behind authorization, not in front
 *  of it. */
export async function recordAudit(entry: NewAuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      actorName: entry.actorName,
      companyId: entry.companyId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousValue: entry.previousValue as never,
      newValue: entry.newValue as never,
    },
  });
}

/**
 * Platform-wide audit trail, cursor-paginated (Phase 17, section 12/4). Before this phase the
 * only consumer of the audit log was a client-side `localStorage`/demo-data mock
 * (`src/services/audit-log.service.ts`) - the real `AuditLog` table (already 900+ rows and
 * growing from ordinary platform-admin activity) had no read path at all. `timestamp` is this
 * model's own date column (not `createdAt`, unlike every other cursor-paginated model in this
 * app) - mapped onto the shape `toCursorPage` expects rather than duplicating its logic.
 */
/** `scope: 'platform'` restricts the feed to entries with no `companyId` (recorded by
 *  PRODUCT_MODERATED/SUPPLIER_VERIFICATION_CHANGED-style platform actions) - this is what a
 *  PLATFORM_MANAGER's own view of the audit log uses (see /api/audit-log's own route), so a role
 *  that never receives company-transaction access also never sees a specific company's audit
 *  trail through this endpoint. `scope: 'all'` (PLATFORM_SUPER_ADMIN/legacy PLATFORM_ADMIN only)
 *  is unfiltered - the pre-existing behavior. */
export async function listAuditLog(
  pagination: CursorPaginationParams,
  scope: 'all' | 'platform' = 'all',
  // Narrows the platform-wide feed to one company (Phase 28 - the Company Detail page's Activity
  // tab). Deliberately ignored when scope === 'platform' - a PLATFORM_MANAGER's feed is already
  // restricted to companyId: null entries, so a company filter on top of that would just be
  // confusing (it could never match anything), not a new capability.
  companyId?: string,
): Promise<ServiceResult<CursorPage<AuditEntry>>> {
  const cursorFilter = pagination.cursor
    ? {
        OR: [
          { timestamp: { lt: pagination.cursor.createdAt } },
          { timestamp: pagination.cursor.createdAt, id: { lt: pagination.cursor.id } },
        ],
      }
    : {};
  const where = scope === 'platform' ? { ...cursorFilter, companyId: null } : companyId ? { ...cursorFilter, companyId } : cursorFilter;
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: pagination.take + 1,
    // A friendly company name alongside the id (Phase 27 - Activity Center) - AuditLog already
    // has a real `company` relation; this was simply never selected before because the one
    // existing consumer (the platform-wide Audit Log page) never needed a display name, only the
    // raw entityType/entityId. Never a new query - the same rows, one more column.
    include: { company: { select: { name: true } } },
  });
  const page = toCursorPage(
    rows.map((r) => ({ ...r, createdAt: r.timestamp })),
    pagination.take,
  );
  return ok({
    ...page,
    items: page.items.map((r) => ({
      id: r.id,
      actorId: r.actorId ?? '',
      actorName: r.actorName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      previousValue: r.previousValue ?? undefined,
      newValue: r.newValue ?? undefined,
      timestamp: r.timestamp.toISOString(),
      ipAddress: r.ipAddress ?? undefined,
      companyId: r.companyId ?? undefined,
      companyName: r.company?.name,
    })),
  });
}

/** Records a PLATFORM_SUPER_ADMIN (or legacy PLATFORM_ADMIN) reading a specific company's
 *  transactional resource through the tenant-isolation bypass (Phase 26 - closes
 *  ACCESS_CONTROL_IMPLEMENTATION_REPORT.md Section 17's "Super Admin cross-company reads are not
 *  individually audit-logged" gap). Deliberately narrow and cheap to call: a no-op unless the
 *  caller's tenant actually used the bypass (`isPlatformAdmin`) - an ordinary company user
 *  reading their own order/invoice/purchase-order never reaches this, so normal tenant-scoped
 *  traffic generates zero extra writes. Call this for the specific, sensitive single-resource
 *  reads the brief names (orders, invoices, purchase orders, budgets) - not every page load; a
 *  platform-wide list view (GET /api/orders, /api/payments, /api/analytics, /api/disputes) is
 *  audited once per call instead of once per row, via the same function with `entityId: 'LIST'`. */
export async function auditCrossCompanyRead(
  auth: { tenant: { isPlatformAdmin?: boolean }; userId: string; userName: string },
  resourceType: string,
  resourceId: string,
  companyId?: string,
): Promise<void> {
  if (!auth.tenant.isPlatformAdmin) return;
  await recordAudit({
    actorId: auth.userId,
    actorName: auth.userName,
    companyId,
    action: 'SUPER_ADMIN_CROSS_COMPANY_READ',
    entityType: resourceType,
    entityId: resourceId,
  });
}

/** A single company's own audit trail (section 28 - "Company A users must not see Company B
 *  audit records"). The route calling this must have already validated `companyId` against the
 *  caller's own session-derived tenant (requireCompanyAccess) - this function trusts the
 *  `companyId` it's given exactly as far as that. */
export async function listCompanyAuditLog(companyId: string, pagination: CursorPaginationParams): Promise<ServiceResult<CursorPage<AuditEntry>>> {
  const cursorFilter = pagination.cursor
    ? {
        OR: [
          { timestamp: { lt: pagination.cursor.createdAt } },
          { timestamp: pagination.cursor.createdAt, id: { lt: pagination.cursor.id } },
        ],
      }
    : {};
  const rows = await db.auditLog.findMany({
    where: { ...cursorFilter, companyId },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: pagination.take + 1,
  });
  const page = toCursorPage(
    rows.map((r) => ({ ...r, createdAt: r.timestamp })),
    pagination.take,
  );
  return ok({
    ...page,
    items: page.items.map((r) => ({
      id: r.id,
      actorId: r.actorId ?? '',
      actorName: r.actorName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      previousValue: r.previousValue ?? undefined,
      newValue: r.newValue ?? undefined,
      timestamp: r.timestamp.toISOString(),
      ipAddress: r.ipAddress ?? undefined,
    })),
  });
}
