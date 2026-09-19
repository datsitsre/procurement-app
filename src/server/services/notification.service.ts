import 'server-only';
import { db } from '@/server/db';
import { ok } from '@/services/base';
import { toNotificationDto } from '@/server/dto/notification';
import { toCursorPage, type CursorPaginationParams } from '@/server/pagination';
import type { CursorPage, ServiceResult, UUID } from '@/types/common';
import type { Notification, NotificationType } from '@/types/notification';
import type { Role } from '@/config/rbac';

/**
 * The real, database-backed counterpart to src/services/notification.service.ts's mock (Phase
 * 14, Stage 9) - the read/mark-read side is a direct migration; `notifyUser`/`notifyCompanyRoles`
 * are new, called internally by other server services at the exact moments the pre-existing demo
 * notification data implied (a quote arriving, an approval moving to the next step or finishing,
 * ...) so notifications are finally real events, not just a fixed seeded list.
 */

/** Cursor-paginated (Phase 16, section 5) - notifications are an append-only feed that can grow
 *  without bound for a long-lived account, so this is keyed on `createdAt+id` rather than an
 *  offset. The cursor itself is never trusted for authorization: the query stays scoped to
 *  `userId` regardless of what a caller passes in. */
export async function list(userId: UUID, pagination: CursorPaginationParams): Promise<ServiceResult<CursorPage<Notification>>> {
  const where = pagination.cursor
    ? {
        userId,
        OR: [
          { createdAt: { lt: pagination.cursor.createdAt } },
          { createdAt: pagination.cursor.createdAt, id: { lt: pagination.cursor.id } },
        ],
      }
    : { userId };
  const rows = await db.notification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.take + 1,
  });
  const page = toCursorPage(rows, pagination.take);
  return ok({ ...page, items: page.items.map(toNotificationDto) });
}

/** Server-side unread count (Phase 16) - the notification bell's badge must reflect every unread
 *  notification, not just whichever page happens to be loaded in the browser. */
export async function getUnreadCount(userId: UUID): Promise<ServiceResult<number>> {
  const count = await db.notification.count({ where: { userId, read: false } });
  return ok(count);
}

export async function markRead(notificationId: UUID, userId: UUID): Promise<ServiceResult<void>> {
  // Scoped to the caller's own id, not just the notification id - otherwise any authenticated
  // user could mark (or, with a GET-turned-mutation, later reason about) another user's
  // notification just by guessing its id.
  await db.notification.updateMany({ where: { id: notificationId, userId }, data: { read: true } });
  return ok(undefined);
}

export async function markAllRead(userId: UUID): Promise<ServiceResult<void>> {
  await db.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  return ok(undefined);
}

export interface NewNotification {
  type: NotificationType;
  title: string;
  body: string;
  entityId?: string;
  entityHref?: string;
}

/** Notifies one specific user - used where the event has an unambiguous single recipient (the
 *  RFQ's creator, a purchase request's requester, ...). Never awaited by the caller's own
 *  response path in a way that could fail the triggering action - callers fire-and-forget this,
 *  the same way a real notification dispatch shouldn't be able to roll back the business event
 *  that caused it. */
export async function notifyUser(userId: UUID, notification: NewNotification): Promise<void> {
  await db.notification.create({ data: { userId, ...notification } }).catch(() => undefined);
}

/** Notifies every active member of a company whose role is in `roles` - used where the event's
 *  recipient is "whoever can act on this", not a single stored user id (the next approver band,
 *  a supplier's admins learning a payment came in, ...). */
export async function notifyCompanyRoles(companyId: UUID, roles: Role[], notification: NewNotification): Promise<void> {
  const members = await db.companyMembership.findMany({
    where: { companyId, status: 'ACTIVE', role: { in: roles } },
    select: { userId: true },
  });
  await db.notification
    .createMany({ data: members.map((m) => ({ userId: m.userId, ...notification })) })
    .catch(() => undefined);
}
