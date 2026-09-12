'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { notificationService } from '@/services/notification.service';
import { formatRelativeTime } from '@/utils/format';
import type { Notification } from '@/types/notification';
import { EmptyState } from '@/components/ui/EmptyState';

export function NotificationBell() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session) return;
    notificationService.list(session.user.id).then((result) => {
      if (result.ok) setNotifications(result.data);
      setLoading(false);
    });
  }, [session]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (!session) return null;
  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleOpen() {
    setOpen((v) => !v);
  }

  async function markAllRead() {
    await notificationService.markAllRead(session!.user.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-neutral-bg hover:text-text-primary"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-h3">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? null : notifications.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="No notifications"
                description="You're all caught up."
                className="border-0 py-10"
              />
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.entityHref ?? '#'}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'block border-b border-border px-4 py-3 text-sm hover:bg-neutral-bg',
                        !n.read && 'bg-info-bg/40',
                      )}
                    >
                      <p className="font-medium text-text-primary">{n.title}</p>
                      <p className="text-caption">{n.body}</p>
                      <p className="mt-1 text-metadata">{formatRelativeTime(n.createdAt)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
