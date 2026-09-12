'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { notificationService } from '@/services/notification.service';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { formatRelativeTime } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { Notification } from '@/types/notification';

export default function NotificationsPage() {
  const { session } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!session) return;
    notificationService.list(session.user.id).then((result) => {
      if (result.ok) setNotifications(result.data);
    });
  }, [session]);

  async function markAllRead() {
    if (!session) return;
    await notificationService.markAllRead(session.user.id);
    setNotifications((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null);
  }

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

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

      <Card>
        {notifications === null ? (
          <div className="p-5">
            <SkeletonText lines={5} />
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You're all caught up." className="border-0" />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.entityHref ?? '#'}
                  className={cn('flex items-start justify-between gap-4 px-5 py-4 hover:bg-neutral-bg', !n.read && 'bg-info-bg/40')}
                >
                  <div>
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-caption">{n.body}</p>
                  </div>
                  <span className="whitespace-nowrap text-metadata">{formatRelativeTime(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
