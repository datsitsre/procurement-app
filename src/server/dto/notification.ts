import 'server-only';
import type { Notification, NotificationType } from '@/types/notification';
import type { Notification as PrismaNotification } from '@prisma/client';

export function toNotificationDto(n: PrismaNotification): Notification {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type as NotificationType,
    title: n.title,
    body: n.body,
    entityId: n.entityId ?? undefined,
    entityHref: n.entityHref ?? undefined,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}
