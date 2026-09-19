'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useWorkspace } from '@/hooks/useAuth';
import { CartProvider } from '@/hooks/useCart';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { BottomNav } from '@/components/layout/BottomNav';
import { buyerNav, buyerBottomNav, supplierNav, supplierBottomNav, platformNav } from '@/config/navigation';

const navByWorkspace = {
  buyer: buyerNav,
  supplier: supplierNav,
  platform: platformNav,
};

const brandByWorkspace = {
  buyer: 'Procurement',
  supplier: 'Supplier hub',
  platform: 'Platform admin',
};

const SIDEBAR_COLLAPSED_KEY = 'procurement.sidebar-collapsed.v1';

/** Purely a per-viewer layout preference (does the sidebar show labels or just icons) - never
 *  read back by the server and never a source of application data, so localStorage is the right
 *  tool here (unlike the mocks this app spent several phases migrating away from). Read lazily
 *  so the very first client render matches whatever the last render actually was, not a flash
 *  of the default. */
function readCollapsedPreference(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
}

/**
 * Shell for every authenticated page: sidebar + topbar on desktop, topbar + bottom nav on
 * mobile (section 8). Not authenticated -> redirected to /login; this is a UX convenience,
 * not the security boundary - see services/base.ts's assertPermission for where that lives
 * once mock services are replaced with a real, backend-enforced API.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, loading } = useAuth();
  const workspace = useWorkspace();
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login');
    }
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" aria-label="Loading" />
      </div>
    );
  }

  const navItems = navByWorkspace[workspace];

  return (
    <CartProvider>
      <div className="min-h-screen bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground print:hidden"
        >
          Skip to main content
        </a>
        <Sidebar items={navItems} brandLabel={brandByWorkspace[workspace]} collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
        {/* print:pl-0 - the sidebar it's otherwise reserving room for is print:hidden, so without
            this a printed/saved-to-PDF page keeps a blank left gutter the width of the sidebar. */}
        <div
          style={{ ['--content-pl' as string]: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
          className="flex flex-col lg:pl-(--content-pl) print:pl-0"
        >
          <Topbar />
          {/* print:pb-0 - pb-24 exists to clear the mobile bottom nav, which is itself
              print:hidden; left as-is this would just be blank trailing space in a PDF. */}
          <main id="main-content" tabIndex={-1} className="flex-1 px-4 pt-6 pb-24 lg:px-6 lg:pb-10 print:p-0">
            {children}
          </main>
        </div>
        {workspace === 'buyer' && <BottomNav items={buyerBottomNav} moreHref="/more" />}
        {workspace === 'supplier' && <BottomNav items={supplierBottomNav} moreHref="/more" />}
      </div>
    </CartProvider>
  );
}
