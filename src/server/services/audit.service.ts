import 'server-only';
import { db } from '@/server/db';

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
