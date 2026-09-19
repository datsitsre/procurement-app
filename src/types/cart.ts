import type { UUID } from './common';

export interface CartItem {
  id: UUID;
  productId: UUID;
  supplierId: UUID;
  quantity: number;
  /** Snapshot of the resolved bulk-pricing unit price at the moment it was added/updated -
   *  recomputed live from the product's price tiers whenever quantity changes, never stale. */
  unitPrice: number;
}

export interface Cart {
  id: UUID;
  companyId: UUID;
  items: CartItem[];
}
