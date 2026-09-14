import 'server-only';
import { db } from '@/server/db';
import { ok } from '@/services/base';
import { toNotificationDto } from '@/server/dto/notification';
import type { ServiceResult, UUID } from '@/types/common';
import type { Notification, NotificationType } from '@/types/notification';
import type { Role } from '@/config/rbac';

/**
 * The real, database-backed counterpart to src/services/notification.service.ts's mock (Phase
 * 14, Stage 9) - the read/mark-read side is a direct migration; `notifyUser`/`notifyCompanyRoles`
 * are new, called internally by other server services at the exact moments the pre-existing demo
 * notification data implied (a quote arriving, an approval moving to the next step or finishing,
 * ...) so notifications are finally real events, not just a fixed seeded list.
 */

export async function list(userId: UUID): Promise<ServiceResult<Notification[]>> {
  const notifications = await db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return ok(notifications.map(toNotificationDto));
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
