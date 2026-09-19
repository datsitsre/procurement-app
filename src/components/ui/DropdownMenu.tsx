'use client';

import { cloneElement, useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

export interface DropdownMenuProps {
  trigger: React.ReactElement<{ onClick?: React.MouseEventHandler; 'aria-haspopup'?: string; 'aria-expanded'?: boolean }>;
  children: React.ReactNode;
  align?: 'start' | 'end';
}

/**
 * The same open/close-on-outside-click pattern already hand-rolled in UserMenu/NotificationBell/
 * CompanySwitcher, extracted once so new menus don't reimplement it. Existing call sites weren't
 * migrated (they work, are tested, and migrating them is a refactor with no user-facing benefit,
 * not a redesign) - this is for new dropdown menus going forward.
 */
export function DropdownMenu({ trigger, children, align = 'end' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
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

  const triggerElement = cloneElement(trigger, {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: () => setOpen((v) => !v),
  });

  return (
    <div className="relative" ref={containerRef}>
      {triggerElement}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-40 mt-2 min-w-48 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownMenuItem({
  children,
  onClick,
  className,
  destructive,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-neutral-bg',
        destructive ? 'text-danger hover:bg-danger-bg' : 'text-text-secondary hover:text-text-primary',
        className,
      )}
    >
      {children}
    </button>
  );
}
