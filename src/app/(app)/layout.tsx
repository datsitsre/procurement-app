'use client';

import { useEffect } from 'react';
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
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground"
        >
          Skip to main content
        </a>
        <Sidebar items={navItems} brandLabel={brandByWorkspace[workspace]} />
        <div className="flex flex-col lg:pl-(--sidebar-width)">
          <Topbar />
          <main id="main-content" tabIndex={-1} className="flex-1 px-4 pt-6 pb-24 lg:px-6 lg:pb-10">
            {children}
          </main>
        </div>
        {workspace === 'buyer' && <BottomNav items={buyerBottomNav} moreHref="/more" />}
        {workspace === 'supplier' && <BottomNav items={supplierBottomNav} moreHref="/more" />}
      </div>
    </CartProvider>
  );
}
