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
export async function listAuditLog(pagination: CursorPaginationParams): Promise<ServiceResult<CursorPage<AuditEntry>>> {
  const where = pagination.cursor
    ? {
        OR: [
          { timestamp: { lt: pagination.cursor.createdAt } },
          { timestamp: pagination.cursor.createdAt, id: { lt: pagination.cursor.id } },
        ],
      }
    : {};
  const rows = await db.auditLog.findMany({
    where,
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
