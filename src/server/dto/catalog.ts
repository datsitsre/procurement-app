import 'server-only';
import type { Category, InventoryRecord, PriceTier, Product, ProductSpecification, Warehouse } from '@/types/catalog';
import type {
  Category as PrismaCategory,
  InventoryRecord as PrismaInventoryRecord,
  PriceTier as PrismaPriceTier,
  Product as PrismaProduct,
  ProductSpecification as PrismaProductSpecification,
  Warehouse as PrismaWarehouse,
} from '@prisma/client';

/** Maps Prisma's generated catalog models to the exact frontend types (src/types/catalog.ts) -
 *  Decimal -> number, Date -> ISO string, never a raw ORM entity crossing the API boundary
 *  (section 36). */

export function toCategoryDto(c: PrismaCategory): Category {
  return { id: c.id, name: c.name, slug: c.slug, parentId: c.parentId ?? undefined };
}

export function toPriceTierDto(t: PrismaPriceTier): PriceTier {
  return { minQty: t.minQty, maxQty: t.maxQty ?? undefined, unitPrice: Number(t.unitPrice) };
}

export function toSpecDto(s: PrismaProductSpecification): ProductSpecification {
  return { label: s.label, value: s.value };
}

export function toInventoryDto(i: PrismaInventoryRecord): InventoryRecord {
  return { warehouseId: i.warehouseId, stock: i.stock, reserved: i.reserved, lowStockThreshold: i.lowStockThreshold };
}

export function toWarehouseDto(w: PrismaWarehouse): Warehouse {
  return { id: w.id, supplierId: w.supplierId, name: w.name, city: w.city, isDefault: w.isDefault };
}

type ProductWithRelations = PrismaProduct & {
  specifications: PrismaProductSpecification[];
  priceTiers: PrismaPriceTier[];
  inventory: PrismaInventoryRecord[];
};

export function toProductDto(p: ProductWithRelations): Product {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    sku: p.sku,
    supplierId: p.supplierId,
    categoryId: p.categoryId,
    moderationStatus: p.moderationStatus,
    moderationNote: p.moderationNote ?? undefined,
    images: p.images,
    description: p.description,
    specifications: p.specifications.map(toSpecDto),
    currency: p.currency as Product['currency'],
    basePrice: Number(p.basePrice),
    priceTiers: p.priceTiers.map(toPriceTierDto),
    moq: p.moq,
    inventory: p.inventory.map(toInventoryDto),
    rating: Number(p.rating),
    reviewCount: p.reviewCount,
    createdAt: p.createdAt.toISOString(),
  };
}
