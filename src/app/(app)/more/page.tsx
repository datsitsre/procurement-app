'use client';

import Link from 'next/link';
import { ChevronRight, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth, useWorkspace } from '@/hooks/useAuth';
import { buyerNav, supplierNav, platformNav } from '@/config/navigation';
import { Card } from '@/components/ui/Card';

const navByWorkspace = { buyer: buyerNav, supplier: supplierNav, platform: platformNav };

/** Mobile-only "More" screen (section 44) - the full nav that doesn't fit in the bottom tab
 *  bar, plus sign-out. Desktop users never see this route since the full sidebar is always
 *  visible there. */
export default function MorePage() {
  const router = useRouter();
  const { can, logout } = useAuth();
  const workspace = useWorkspace();
  const items = navByWorkspace[workspace];

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="flex flex-col gap-6 lg:hidden">
      <h1 className="text-h1">More</h1>
      <Card>
        <nav>
          <ul className="divide-y divide-border">
            {items
              .filter((item) => !item.permission || can(item.permission))
              .map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="flex items-center gap-3 text-sm font-medium">
                      <item.icon className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
                      {item.label}
                    </span>
                    <ChevronRight className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
                  </Link>
                </li>
              ))}
          </ul>
        </nav>
      </Card>
      <Card>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-danger"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </button>
      </Card>
    </div>
  );
}
