import { delay, ok } from './base';
import { demoNotifications } from '@/lib/demo-data/notifications';
import type { Notification } from '@/types/notification';
import type { ServiceResult } from '@/types/common';

export interface NotificationService {
  list(userId: string): Promise<ServiceResult<Notification[]>>;
  markRead(notificationId: string): Promise<ServiceResult<void>>;
  markAllRead(userId: string): Promise<ServiceResult<void>>;
}

/** In-memory mock store - a real implementation replaces this with API calls (and likely a
 *  WebSocket/polling subscription for live delivery), keeping the same interface. */
class MockNotificationService implements NotificationService {
  private notifications = [...demoNotifications];

  async list(userId: string): Promise<ServiceResult<Notification[]>> {
    await delay(200);
    return ok(
      this.notifications
        .filter((n) => n.userId === userId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    );
  }

  async markRead(notificationId: string): Promise<ServiceResult<void>> {
    await delay(100);
    this.notifications = this.notifications.map((n) =>
      n.id === notificationId ? { ...n, read: true } : n,
    );
    return ok(undefined);
  }

  async markAllRead(userId: string): Promise<ServiceResult<void>> {
    await delay(150);
    this.notifications = this.notifications.map((n) =>
      n.userId === userId ? { ...n, read: true } : n,
    );
    return ok(undefined);
  }
}

export const notificationService: NotificationService = new MockNotificationService();
