'use client';

import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '@/hooks/useCart';

export function CartButton() {
  const { itemCount } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={`Cart${itemCount > 0 ? ` (${itemCount} items)` : ''}`}
      className="relative flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-neutral-bg hover:text-text-primary"
    >
      <ShoppingCart className="h-4 w-4" aria-hidden="true" />
      {itemCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
          {itemCount > 99 ? '99+' : itemCount}
        </span>
      )}
    </Link>
  );
}
