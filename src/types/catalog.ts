import type { CurrencyCode, ISODateTime, UUID } from './common';
import type { SupplierVerificationStatus } from './status';

export interface Category {
  id: UUID;
  name: string;
  slug: string;
  parentId?: UUID;
}

/** One tier of a product's bulk-pricing table (section 13). `maxQty` is undefined for the
 *  open-ended top tier (e.g. "100+"). */
export interface PriceTier {
  minQty: number;
  maxQty?: number;
  unitPrice: number;
}

export interface Warehouse {
  id: UUID;
  supplierId: UUID;
  name: string;
  city: string;
  isDefault?: boolean;
}

/** Per-warehouse stock for a product (section 34/35). */
export interface InventoryRecord {
  warehouseId: UUID;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
}

export interface ProductSpecification {
  label: string;
  value: string;
}

export type ProductModerationStatus = 'PUBLISHED' | 'PENDING_REVIEW' | 'REJECTED';

export interface Product {
  id: UUID;
  slug: string;
  name: string;
  brand: string;
  sku: string;
  supplierId: UUID;
  categoryId: UUID;
  /** Platform moderation state (section 46/62) - a newly-submitted product starts
   *  PENDING_REVIEW and is excluded from the buyer-facing catalog until an admin publishes it;
   *  seed products are already PUBLISHED since they represent an established listing. */
  moderationStatus: ProductModerationStatus;
  moderationNote?: string;
  images: string[];
  description: string;
  specifications: ProductSpecification[];
  currency: CurrencyCode;
  /** Base unit price, shown before bulk-pricing tiers are applied. */
  basePrice: number;
  priceTiers: PriceTier[];
  /** Minimum order quantity - see section 14. Orders below this must be rejected client-side
   *  (and, in a real backend, server-side) before they ever reach checkout. */
  moq: number;
  inventory: InventoryRecord[];
  rating: number;
  reviewCount: number;
  createdAt: ISODateTime;
}

export interface SupplierProfile {
  id: UUID;
  companyId: UUID;
  name: string;
  slug: string;
  logoUrl?: string;
  categories: string[];
  city: string;
  country: string;
  verification: SupplierVerificationStatus;
  rating: number;
  reviewCount: number;
  responseTimeHours: number;
  completedOrders: number;
  certifications: string[];
  description: string;
}

/** Resolves the correct bulk-pricing tier (and the per-unit savings vs. the base tier) for a
 *  requested quantity - shared by product cards, the product detail page, and the cart so the
 *  same number is never computed two different ways. */
export function resolveTierPrice(
  product: Pick<Product, 'basePrice' | 'priceTiers'>,
  quantity: number,
): { unitPrice: number; savingsPerUnit: number; tier: PriceTier | null } {
  const sorted = [...product.priceTiers].sort((a, b) => a.minQty - b.minQty);
  const tier =
    sorted.filter((t) => quantity >= t.minQty && (t.maxQty === undefined || quantity <= t.maxQty)).pop() ?? null;
  const unitPrice = tier ? tier.unitPrice : product.basePrice;
  const baseTier = sorted[0]?.unitPrice ?? product.basePrice;
  return { unitPrice, savingsPerUnit: Math.max(0, baseTier - unitPrice), tier };
}

export function availableStock(product: Pick<Product, 'inventory'>): number {
  return product.inventory.reduce((sum, w) => sum + (w.stock - w.reserved), 0);
}
