'use client';

import { Search } from 'lucide-react';
import { CompanySwitcher } from './CompanySwitcher';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

/** Top bar shown above the workspace on every authenticated page, on both desktop (beside the
 *  fixed sidebar) and mobile (above the page content, with bottom nav replacing the sidebar). */
export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-(--topbar-height) items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
      <div className="relative hidden flex-1 max-w-md md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
        <input
          type="search"
          placeholder="Search products, suppliers, orders, RFQs…"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
        <CompanySwitcher />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
