import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toCategoryDto, toProductDto, toWarehouseDto } from '@/server/dto/catalog';
import { recordAudit } from './audit.service';
import type { ServiceResult, UUID } from '@/types/common';
import type { Category, Product, Warehouse } from '@/types/catalog';
import type { Prisma } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/catalog.service.ts's mock - products,
 * categories, and warehouses only (Phase 14, Stage 4). Suppliers stay on the existing mock for
 * now - see the block comment in the client catalog.service.ts for why. Route handlers under
 * app/api/products/* and app/api/categories/* call these after their own auth/permission checks
 * have already passed.
 */

const PRODUCT_INCLUDE = { specifications: true, priceTiers: true, inventory: true } satisfies Prisma.ProductInclude;

export async function listCategories(): Promise<ServiceResult<Category[]>> {
  const categories = await db.category.findMany({ orderBy: { name: 'asc' } });
  return ok(categories.map(toCategoryDto));
}

export interface ProductFilters {
  categorySlug?: string;
  supplierId?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'relevance' | 'priceAsc' | 'priceDesc' | 'rating';
}

/** Only published listings ever reach the buyer-facing catalog (section 46) - a product
 *  pending or rejected in moderation is still visible to its own supplier and to admins, just
 *  not through this query. */
export async function listProducts(filters: ProductFilters = {}): Promise<ServiceResult<Product[]>> {
  const category = filters.categorySlug ? await db.category.findUnique({ where: { slug: filters.categorySlug } }) : null;
  const text = filters.search?.trim();

  const where: Prisma.ProductWhereInput = {
    moderationStatus: 'PUBLISHED',
    ...(category ? { categoryId: category.id } : {}),
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.minPrice !== undefined || filters.maxPrice !== undefined
      ? { basePrice: { gte: filters.minPrice, lte: filters.maxPrice } }
      : {}),
    ...(text
      ? {
          OR: [
            { name: { contains: text, mode: 'insensitive' } },
            { brand: { contains: text, mode: 'insensitive' } },
            { sku: { contains: text, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    filters.sortBy === 'priceAsc'
      ? { basePrice: 'asc' }
      : filters.sortBy === 'priceDesc'
        ? { basePrice: 'desc' }
        : filters.sortBy === 'rating'
          ? { rating: 'desc' }
          : {};

  const products = await db.product.findMany({ where, orderBy, include: PRODUCT_INCLUDE });
  return ok(products.map(toProductDto));
}

export async function getProductBySlug(slug: string): Promise<ServiceResult<Product>> {
  const product = await db.product.findUnique({ where: { slug }, include: PRODUCT_INCLUDE });
  if (!product) return fail('NOT_FOUND', 'That product could not be found.');
  return ok(toProductDto(product));
}

export async function getProductById(id: UUID): Promise<ServiceResult<Product>> {
  const product = await db.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
  if (!product) return fail('NOT_FOUND', 'That product could not be found.');
  return ok(toProductDto(product));
}

/** A supplier's own listing, for the Products & Inventory page (section 34) - unfiltered by
 *  moderation status, since a supplier needs to see their own pending/rejected listings too. */
export async function listProductsForSupplier(supplierId: UUID): Promise<ServiceResult<Product[]>> {
  const products = await db.product.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, include: PRODUCT_INCLUDE });
  return ok(products.map(toProductDto));
}

export async function listWarehousesForSupplier(supplierId: UUID): Promise<ServiceResult<Warehouse[]>> {
  const warehouses = await db.warehouse.findMany({ where: { supplierId } });
  return ok(warehouses.map(toWarehouseDto));
}

export interface NewProductInput {
  supplierId: UUID;
  name: string;
  brand: string;
  sku: string;
  categoryId: UUID;
  description: string;
  currency: Product['currency'];
  basePrice: number;
  moq: number;
  warehouseId: UUID;
  stock: number;
  lowStockThreshold: number;
}

export async function createProduct(input: NewProductInput): Promise<ServiceResult<Product>> {
  if (!input.name.trim()) return fail('EMPTY', 'Give the product a name.');
  if (input.basePrice <= 0) return fail('INVALID_PRICE', 'Set a base price greater than zero.');

  const slug = `${input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}-${Math.floor(1000 + Math.random() * 8999)}`;

  const product = await db.product.create({
    data: {
      slug,
      name: input.name,
      brand: input.brand,
      sku: input.sku,
      supplierId: input.supplierId,
      categoryId: input.categoryId,
      // Every newly-submitted product is held for admin review (section 46) before it can
      // appear in the buyer-facing catalog - see listProducts's moderationStatus filter.
      moderationStatus: 'PENDING_REVIEW',
      description: input.description,
      currency: input.currency,
      basePrice: input.basePrice,
      moq: input.moq,
      inventory: { create: [{ warehouseId: input.warehouseId, stock: input.stock, reserved: 0, lowStockThreshold: input.lowStockThreshold }] },
    },
    include: PRODUCT_INCLUDE,
  });
  return ok(toProductDto(product));
}

export interface ProductPatch {
  name?: string;
  basePrice?: number;
  moq?: number;
  description?: string;
}

/** `supplierId` is the caller's own SupplierProfile.id, already verified by the route handler
 *  (via ownsRecord against the authenticated session's tenant) before this runs - re-checked
 *  here too via the WHERE clause itself (`{ id: productId, supplierId }`), so a request can't
 *  edit a product by guessing its id even if the route-level check were ever bypassed. */
export async function updateProduct(productId: UUID, supplierId: UUID, patch: ProductPatch): Promise<ServiceResult<Product>> {
  const existing = await db.product.findFirst({ where: { id: productId, supplierId } });
  if (!existing) return fail('NOT_FOUND', 'That product could not be found.');

  const product = await db.product.update({ where: { id: productId }, data: patch, include: PRODUCT_INCLUDE });
  return ok(toProductDto(product));
}

export async function updateInventory(
  productId: UUID,
  supplierId: UUID,
  warehouseId: UUID,
  patch: { stock?: number; lowStockThreshold?: number },
): Promise<ServiceResult<Product>> {
  const existing = await db.product.findFirst({ where: { id: productId, supplierId } });
  if (!existing) return fail('NOT_FOUND', 'That product could not be found.');

  await db.inventoryRecord.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: patch,
    create: { productId, warehouseId, stock: patch.stock ?? 0, lowStockThreshold: patch.lowStockThreshold ?? 0 },
  });

  const product = await db.product.findUnique({ where: { id: productId }, include: PRODUCT_INCLUDE });
  return ok(toProductDto(product!));
}

/** Every product across every supplier, unfiltered by moderation status - the admin
 *  product-moderation queue (section 46) reads this, not the buyer-facing listProducts. */
export async function listAllProductsForModeration(): Promise<ServiceResult<Product[]>> {
  const products = await db.product.findMany({ orderBy: { createdAt: 'desc' }, include: PRODUCT_INCLUDE });
  return ok(products.map(toProductDto));
}

export async function moderateProduct(
  productId: UUID,
  decision: 'PUBLISHED' | 'REJECTED',
  note: string | undefined,
  actor: { id: string; name: string },
): Promise<ServiceResult<Product>> {
  const existing = await db.product.findUnique({ where: { id: productId } });
  if (!existing) return fail('NOT_FOUND', 'That product could not be found.');

  const product = await db.product.update({
    where: { id: productId },
    data: { moderationStatus: decision, moderationNote: note },
    include: PRODUCT_INCLUDE,
  });

  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: 'PRODUCT_MODERATED',
    entityType: 'Product',
    entityId: productId,
    previousValue: { moderationStatus: existing.moderationStatus },
    newValue: { moderationStatus: decision, note },
  });

  return ok(toProductDto(product));
}
