import { apiRequest } from './base';
import type { Notification } from '@/types/notification';
import type { ServiceResult } from '@/types/common';

export interface NotificationService {
  list(userId: string): Promise<ServiceResult<Notification[]>>;
  markRead(notificationId: string): Promise<ServiceResult<void>>;
  markAllRead(userId: string): Promise<ServiceResult<void>>;
}

/**
 * Calls the real `/api/notifications*` backend (Phase 14, Stage 9). `userId` is still accepted
 * on `list`/`markAllRead` (every existing page already passes it) but is never sent over the
 * wire or trusted - the API always scopes to the caller's own session id.
 */
class ApiNotificationService implements NotificationService {
  async list(): Promise<ServiceResult<Notification[]>> {
    return apiRequest<Notification[]>('/api/notifications');
  }

  async markRead(notificationId: string): Promise<ServiceResult<void>> {
    return apiRequest<void>(`/api/notifications/${notificationId}/read`, { method: 'POST' });
  }

  async markAllRead(): Promise<ServiceResult<void>> {
    return apiRequest<void>('/api/notifications/read-all', { method: 'POST' });
  }
}

export const notificationService: NotificationService = new ApiNotificationService();
