import { delay, fail, ok } from './base';
import { demoProducts } from '@/lib/demo-data/catalog';
import { resolveTierPrice } from '@/types/catalog';
import type { ServiceResult, UUID } from '@/types/common';
import type { Cart, CartItem } from '@/types/cart';

const CART_STORAGE_PREFIX = 'procurement.cart.';

export interface CartService {
  getCart(companyId: UUID): Promise<ServiceResult<Cart>>;
  setQuantity(companyId: UUID, productId: UUID, quantity: number): Promise<ServiceResult<Cart>>;
  removeItem(companyId: UUID, productId: UUID): Promise<ServiceResult<Cart>>;
  clear(companyId: UUID): Promise<ServiceResult<Cart>>;
}

function storageKey(companyId: UUID): string {
  return `${CART_STORAGE_PREFIX}${companyId}`;
}

function readCart(companyId: UUID): Cart {
  if (typeof window === 'undefined') return { id: `cart-${companyId}`, companyId, items: [] };
  const raw = window.localStorage.getItem(storageKey(companyId));
  if (!raw) return { id: `cart-${companyId}`, companyId, items: [] };
  try {
    return JSON.parse(raw) as Cart;
  } catch {
    return { id: `cart-${companyId}`, companyId, items: [] };
  }
}

function writeCart(cart: Cart) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(cart.companyId), JSON.stringify(cart));
}

/**
 * Every cart is scoped to a `companyId` (tenant) - stored under its own localStorage key, and
 * every method takes the company id explicitly rather than reading some ambient "current
 * company" so it's structurally impossible to read or write another tenant's cart from here
 * (section 47's multi-tenancy requirement, enforced at the same layer a real backend would).
 */
class MockCartService implements CartService {
  async getCart(companyId: UUID): Promise<ServiceResult<Cart>> {
    await delay(150);
    return ok(readCart(companyId));
  }

  async setQuantity(companyId: UUID, productId: UUID, quantity: number): Promise<ServiceResult<Cart>> {
    await delay(150);
    const product = demoProducts.find((p) => p.id === productId);
    if (!product) return fail('NOT_FOUND', 'That product could not be found.');

    if (quantity > 0 && quantity < product.moq) {
      return fail('BELOW_MOQ', `${product.name} has a minimum order quantity of ${product.moq} units.`);
    }

    const cart = readCart(companyId);
    const existingIndex = cart.items.findIndex((i) => i.productId === productId);
    const { unitPrice } = resolveTierPrice(product, quantity);

    let items: CartItem[];
    if (quantity <= 0) {
      items = cart.items.filter((i) => i.productId !== productId);
    } else if (existingIndex >= 0) {
      items = cart.items.map((i, idx) => (idx === existingIndex ? { ...i, quantity, unitPrice } : i));
    } else {
      items = [
        ...cart.items,
        { id: `cartitem-${productId}`, productId, supplierId: product.supplierId, quantity, unitPrice },
      ];
    }

    const next: Cart = { ...cart, items };
    writeCart(next);
    return ok(next);
  }

  async removeItem(companyId: UUID, productId: UUID): Promise<ServiceResult<Cart>> {
    return this.setQuantity(companyId, productId, 0);
  }

  async clear(companyId: UUID): Promise<ServiceResult<Cart>> {
    await delay(150);
    const next: Cart = { id: `cart-${companyId}`, companyId, items: [] };
    writeCart(next);
    return ok(next);
  }
}

export const cartService: CartService = new MockCartService();
