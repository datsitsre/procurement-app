import { apiRequest } from './base';
import type { Notification } from '@/types/notification';
import type { CursorPage, ServiceResult } from '@/types/common';

export interface NotificationService {
  /** Cursor-paginated (Phase 16) - pass the previous call's `nextCursor` to fetch the next page. */
  list(userId: string, cursor?: string | null, pageSize?: number): Promise<ServiceResult<CursorPage<Notification>>>;
  /** Total unread count, computed server-side (Phase 16) - never derive this from a page of
   *  `list`, which only ever holds one page's worth of rows. */
  getUnreadCount(userId: string): Promise<ServiceResult<number>>;
  markRead(notificationId: string): Promise<ServiceResult<void>>;
  markAllRead(userId: string): Promise<ServiceResult<void>>;
}

/**
 * Calls the real `/api/notifications*` backend (Phase 14, Stage 9). `userId` is still accepted
 * on `list`/`getUnreadCount`/`markAllRead` (every existing page already passes it) but is never
 * sent over the wire or trusted - the API always scopes to the caller's own session id.
 */
class ApiNotificationService implements NotificationService {
  async list(_userId: string, cursor?: string | null, pageSize = 25): Promise<ServiceResult<CursorPage<Notification>>> {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (cursor) params.set('cursor', cursor);
    return apiRequest<CursorPage<Notification>>(`/api/notifications?${params.toString()}`);
  }

  async getUnreadCount(): Promise<ServiceResult<number>> {
    const result = await apiRequest<{ count: number }>('/api/notifications/unread-count');
    return result.ok ? { ok: true, data: result.data.count } : result;
  }

  async markRead(notificationId: string): Promise<ServiceResult<void>> {
    return apiRequest<void>(`/api/notifications/${notificationId}/read`, { method: 'POST' });
  }

  async markAllRead(): Promise<ServiceResult<void>> {
    return apiRequest<void>('/api/notifications/read-all', { method: 'POST' });
  }
}

export const notificationService: NotificationService = new ApiNotificationService();
