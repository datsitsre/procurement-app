'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuth } from '@/hooks/useAuth';
import { Tooltip } from '@/components/ui/Tooltip';
import type { NavItem } from '@/config/navigation';

export interface SidebarProps {
  items: NavItem[];
  brandLabel?: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** Desktop-only left navigation rail (section 8/9) - each item is hidden entirely (not just
 *  disabled) when the active company membership's role lacks its permission, so a role never
 *  even sees a link to a page it can't use. Collapsible (section 7) - collapsed state shows
 *  icon-only with a tooltip label, persisted as a per-viewer layout preference (not application
 *  data - see AppLayout's own note on why localStorage is safe here). */
export function Sidebar({ items, brandLabel = 'Procurement', collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { can } = useAuth();

  return (
    <aside
      style={{ width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
      className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] duration-150 lg:flex print:hidden"
    >
      <div className="flex h-(--topbar-height) items-center gap-2 border-b border-border px-5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          P
        </span>
        {!collapsed && <span className="text-h3 truncate">{brandLabel}</span>}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((item) => !item.permission || can(item.permission))
            .map((item, index, visible) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              // A section header prints once, right before the first visible item that carries
              // it - never for a section a role's permission filter emptied out entirely (Phase
              // 27's grouped platformNav; buyer/supplier navs never set `section` at all).
              const showSectionHeader = item.section && item.section !== visible[index - 1]?.section;
              const link = (
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  // Icon-only when collapsed (Phase 19 accessibility audit) - the Tooltip below
                  // supplies `aria-describedby`, which is a *description*, not an accessible
                  // *name*; without this the link would announce with no name at all to a
                  // screen reader while collapsed.
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    collapsed && 'justify-center px-0',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-text-secondary hover:bg-neutral-bg hover:text-text-primary',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!collapsed && item.label}
                </Link>
              );
              return (
                <li key={item.href}>
                  {showSectionHeader && !collapsed && (
                    <p className="mt-3 mb-1 px-3 text-metadata first:mt-0" aria-hidden="true">
                      {item.section}
                    </p>
                  )}
                  {collapsed ? <Tooltip content={item.label} side="top">{link}</Tooltip> : link}
                </li>
              );
            })}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-text-secondary',
            'hover:bg-neutral-bg hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}
