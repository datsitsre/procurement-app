'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import type { NavItem } from '@/config/navigation';

export interface SidebarProps {
  items: NavItem[];
  brandLabel?: string;
}

/** Desktop-only left navigation rail (section 8/9) - each item is hidden entirely (not just
 *  disabled) when the active company membership's role lacks its permission, so a role never
 *  even sees a link to a page it can't use. */
export function Sidebar({ items, brandLabel = 'Procurement' }: SidebarProps) {
  const pathname = usePathname();
  const { can } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-(--sidebar-width) flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-(--topbar-height) items-center gap-2 border-b border-border px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          P
        </span>
        <span className="text-h3">{brandLabel}</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((item) => !item.permission || can(item.permission))
            .map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-text-secondary hover:bg-neutral-bg hover:text-text-primary',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
    </aside>
  );
}
