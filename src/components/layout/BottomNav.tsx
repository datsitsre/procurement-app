'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import type { NavItem } from '@/config/navigation';

export interface BottomNavProps {
  items: NavItem[];
  moreHref: string;
}

/** Mobile-only tab bar (section 8/44) - a deliberately short list (home + the 3 most-used
 *  sections), with a "More" tab linking to the full nav for everything else. Filtered by
 *  permission the same way Sidebar is (section 10) - a role that lacks a tab's permission
 *  (EMPLOYEE/BUYER never hold analytics.read, for instance) never sees a shortcut to a page it
 *  can't use. */
export function BottomNav({ items, moreHref }: BottomNavProps) {
  const pathname = usePathname();
  const { can } = useAuth();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-(--bottom-nav-height) border-t border-border bg-surface lg:hidden print:hidden">
      {items
        .filter((item) => !item.permission || can(item.permission))
        .map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
              active ? 'text-accent' : 'text-text-tertiary',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
      <Link
        href={moreHref}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        More
      </Link>
    </nav>
  );
}
