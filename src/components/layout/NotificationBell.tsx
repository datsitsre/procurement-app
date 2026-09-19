'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { notificationService } from '@/services/notification.service';
import { formatRelativeTime } from '@/utils/format';
import type { CursorPage } from '@/types/common';
import type { Notification } from '@/types/notification';
import { EmptyState } from '@/components/ui/EmptyState';

// Polled, not just fetched once, so a notification another party's action just created (a
// negotiation reply, a quote arriving, ...) shows up here on its own - the alternative is the
// unread dot never appearing until the viewer happens to reload the page.
const POLL_INTERVAL_MS = 20_000;
// The dropdown only ever shows the most recent handful - it's a preview, not the full history
// (that's what the /notifications page is for), so it fetches a single small page.
const PREVIEW_SIZE = 20;

export function NotificationBell() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: page, loading, reload } = useAsyncData<CursorPage<Notification>>(
    session?.user.id ?? null,
    () => notificationService.list(session!.user.id, null, PREVIEW_SIZE),
    { pollIntervalMs: POLL_INTERVAL_MS },
  );
  const notifications = page?.items ?? [];
  // Computed server-side (Phase 16) - never derived from `notifications`, which only ever holds
  // this dropdown's one small preview page, not every unread notification.
  const { data: unreadCount, reload: reloadUnreadCount } = useAsyncData<number>(
    session?.user.id ?? null,
    () => notificationService.getUnreadCount(session!.user.id),
    { pollIntervalMs: POLL_INTERVAL_MS },
  );

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // Phase 19 accessibility audit - a keyboard user who opened this dropdown had no way to
    // close it without a mouse click outside.
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  if (!session) return null;
  const unread = unreadCount ?? 0;

  async function handleOpen() {
    setOpen((v) => !v);
  }

  async function markAllRead() {
    await notificationService.markAllRead(session!.user.id);
    reload();
    reloadUnreadCount();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-neutral-bg hover:text-text-primary"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-h3">Notifications</span>
            {unread > 0 && (
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
                      <p className={cn('text-text-primary', n.read ? 'font-medium' : 'font-semibold')}>
                        {n.title}
                        {/* Unread is never signaled by color alone (section 25). */}
                        {!n.read && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-label="Unread" />}
                      </p>
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
