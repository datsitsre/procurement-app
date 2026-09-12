'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cartService } from '@/services/cart.service';
import { useAuth } from './useAuth';
import { demoProducts } from '@/lib/demo-data/catalog';
import { resolveTierPrice } from '@/types/catalog';
import type { Cart, CartItem } from '@/types/cart';
import type { Product } from '@/types/catalog';
import type { ServiceError } from '@/types/common';

export interface CartLine {
  item: CartItem;
  product: Product;
  lineTotal: number;
  savingsPerUnit: number;
}

interface CartContextValue {
  cart: Cart | null;
  loading: boolean;
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  setQuantity: (productId: string, quantity: number) => Promise<ServiceError | null>;
  removeItem: (productId: string) => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const companyId = session?.activeCompanyId ?? null;

  // { companyId, cart } together, so a stale response for a company the user has since
  // switched away from can be detected and ignored (companyId !== the latest one requested).
  const [loaded, setLoaded] = useState<{ companyId: string | null; cart: Cart | null }>({ companyId: null, cart: null });
  const latestCompanyIdRef = useRef<string | null>(null);

  useEffect(() => {
    latestCompanyIdRef.current = companyId;
    if (!companyId) return; // derived `cart` below already reads as null once companyId !== loaded.companyId
    cartService.getCart(companyId).then((result) => {
      if (latestCompanyIdRef.current !== companyId) return; // company switched again before this resolved
      setLoaded({ companyId, cart: result.ok ? result.data : null });
    });
  }, [companyId]);

  const cart = loaded.companyId === companyId ? loaded.cart : null;
  const loading = companyId !== null && loaded.companyId !== companyId;

  const setQuantity = useCallback(
    async (productId: string, quantity: number) => {
      if (!companyId) return null;
      const result = await cartService.setQuantity(companyId, productId, quantity);
      if (result.ok) {
        setLoaded({ companyId, cart: result.data });
        return null;
      }
      return result.error;
    },
    [companyId],
  );

  const removeItem = useCallback(
    async (productId: string) => {
      if (!companyId) return;
      const result = await cartService.removeItem(companyId, productId);
      if (result.ok) setLoaded({ companyId, cart: result.data });
    },
    [companyId],
  );

  const lines = useMemo<CartLine[]>(() => {
    if (!cart) return [];
    return cart.items
      .map((item) => {
        const product = demoProducts.find((p) => p.id === item.productId);
        if (!product) return null;
        const { unitPrice, savingsPerUnit } = resolveTierPrice(product, item.quantity);
        return { item, product, lineTotal: unitPrice * item.quantity, savingsPerUnit };
      })
      .filter((l): l is CartLine => l !== null);
  }, [cart]);

  const itemCount = lines.reduce((sum, l) => sum + l.item.quantity, 0);
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const value = useMemo<CartContextValue>(
    () => ({ cart, loading, lines, itemCount, subtotal, setQuantity, removeItem }),
    [cart, loading, lines, itemCount, subtotal, setQuantity, removeItem],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a <CartProvider>');
  return ctx;
}
