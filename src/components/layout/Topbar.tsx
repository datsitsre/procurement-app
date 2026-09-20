'use client';

import { Search, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '@/hooks/useAuth';
import { CompanySwitcher } from './CompanySwitcher';
import { NotificationBell } from './NotificationBell';
import { CartButton } from './CartButton';
import { UserMenu } from './UserMenu';

/** Top bar shown above the workspace on every authenticated page, on both desktop (beside the
 *  fixed sidebar) and mobile (above the page content, with bottom nav replacing the sidebar). */
export function Topbar() {
  const workspace = useWorkspace();

  return (
    <header className="sticky top-0 z-20 flex h-(--topbar-height) items-center gap-3 border-b border-border bg-surface px-4 lg:px-6 print:hidden">
      <div className="relative hidden flex-1 max-w-md md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
        <input
          type="search"
          placeholder="Search products, suppliers, orders, RFQs…"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
        {workspace === 'platform' ? (
          // Platform Headquarters is not a company a platform admin "switches into" the way a
          // buyer with several entities would (section 11) - CompanySwitcher's company-picker UI
          // (and its "no company" fallback wording) would misleadingly imply otherwise, so
          // platform staff get a plain role badge here instead.
          <span className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary">
            <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
            Platform administration
          </span>
        ) : (
          <CompanySwitcher />
        )}
        {/* A shopping cart is a buyer-side procurement concept - showing it to supplier/platform
            staff (who can never check out anything) is clutter, not a feature (section 15). */}
        {workspace === 'buyer' && <CartButton />}
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
