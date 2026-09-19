'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, Settings } from 'lucide-react';
import { useAuth, useActiveMembership } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { RoleLabels } from '@/config/rbac';

export function UserMenu() {
  const router = useRouter();
  const { session, logout } = useAuth();
  const membership = useActiveMembership();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // Phase 19 accessibility audit - a keyboard user who opened this menu had no way to close it
    // without a mouse click outside; Escape is the expected way to dismiss any open menu/popup.
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

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md p-1 hover:bg-neutral-bg"
      >
        <Avatar name={session.user.name} imageUrl={session.user.avatarUrl} size="sm" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-medium">{session.user.name}</p>
            <p className="text-caption">{session.user.email}</p>
            {membership && <p className="mt-1 text-metadata">{RoleLabels[membership.role]}</p>}
          </div>
          <nav className="py-1">
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:bg-neutral-bg hover:text-text-primary"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger hover:bg-danger-bg"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Log out
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}
