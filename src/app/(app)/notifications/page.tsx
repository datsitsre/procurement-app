'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  FileText,
  MessageSquare,
  CheckCircle2,
  Wallet,
  Truck,
  TriangleAlert,
  Receipt,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { notificationService } from '@/services/notification.service';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { formatRelativeTime } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { Notification, NotificationType } from '@/types/notification';

const PAGE_SIZE = 25;

/** One icon per notification type (section 22's "notification type" requirement) - a purely
 *  visual aid alongside the title text, which already names the event; never the only way to
 *  tell notifications apart. */
const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  RFQ_NEW: FileText,
  QUOTE_RECEIVED: FileText,
  QUOTE_ACCEPTED: CheckCircle2,
  NEGOTIATION_MESSAGE: MessageSquare,
  APPROVAL_REQUESTED: CheckCircle2,
  APPROVAL_DECIDED: CheckCircle2,
  PAYMENT_RECEIVED: Wallet,
  ORDER_SHIPPED: Truck,
  DELIVERY_DELAYED: TriangleAlert,
  INVOICE_DUE: Receipt,
  LOW_STOCK: AlertTriangle,
  RECURRING_PURCHASE_GENERATED: RefreshCw,
  RECURRING_PURCHASE_FAILED: TriangleAlert,
};

export default function NotificationsPage() {
  const { session } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!session) return;
    notificationService.list(session.user.id, null, PAGE_SIZE).then((result) => {
      if (result.ok) {
        setError(null);
        setNotifications(result.data.items);
        setNextCursor(result.data.nextCursor);
        setHasNext(result.data.hasNext);
      } else {
        setError(result.error.message);
      }
    });
    notificationService.getUnreadCount(session.user.id).then((result) => {
      if (result.ok) setUnreadCount(result.data);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function loadMore() {
    if (!session || !nextCursor) return;
    setLoadingMore(true);
    const result = await notificationService.list(session.user.id, nextCursor, PAGE_SIZE);
    if (result.ok) {
      setNotifications((prev) => [...(prev ?? []), ...result.data.items]);
      setNextCursor(result.data.nextCursor);
      setHasNext(result.data.hasNext);
    }
    setLoadingMore(false);
  }

  async function markAllRead() {
    if (!session) return;
    await notificationService.markAllRead(session.user.id);
    setNotifications((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null);
    setUnreadCount(0);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h1">Notifications</h1>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState title="Couldn't load notifications" description={error} secondaryAction={{ label: 'Try again', onClick: load }} />
      ) : (
        <Card>
          {notifications === null ? (
            <div className="p-5">
              <SkeletonText lines={5} />
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications" description="You're all caught up." className="border-0" />
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                return (
                  <li key={n.id}>
                    <Link
                      href={n.entityHref ?? '#'}
                      className={cn('flex items-start gap-3 px-5 py-4 hover:bg-neutral-bg', !n.read && 'bg-info-bg/40')}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                      <div className="flex-1">
                        <p className={cn('text-sm', n.read ? 'font-medium' : 'font-semibold')}>
                          {n.title}
                          {/* Unread is never signaled by color alone (section 25) - this dot plus
                              the bolder title weight above both carry the same information. */}
                          {!n.read && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-label="Unread" />}
                        </p>
                        <p className="text-caption">{n.body}</p>
                      </div>
                      <span className="whitespace-nowrap text-metadata">{formatRelativeTime(n.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {hasNext && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
