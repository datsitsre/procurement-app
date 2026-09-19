import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toCategoryDto, toProductDto, toSupplierProfileDto, toWarehouseDto } from '@/server/dto/catalog';
import { toPage, type PaginationParams } from '@/server/pagination';
import { recordAudit } from './audit.service';
import type { Page, ServiceResult, UUID } from '@/types/common';
import type { Category, Product, SupplierProfile, Warehouse } from '@/types/catalog';
import type { Prisma } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/catalog.service.ts's mock - products,
 * categories, warehouses, and (as of this file's supplier directory functions) suppliers (Phase
 * 14, Stage 4 migrated products/categories/warehouses; suppliers were deliberately deferred at
 * the time - see the client catalog.service.ts's own removed block comment on why - since ~18
 * call sites across the app read supplier data through *synchronous* accessors a real
 * network-backed service can't serve directly. That's solved client-side (an in-memory cache
 * populated by whichever async call ran most recently), not here - this file only needs to
 * offer real async reads/writes, the same shape every other domain in this file already has.
 * Route handlers under app/api/products/*, app/api/categories/*, and app/api/suppliers/* call
 * these after their own auth/permission checks have already passed.
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

/**
 * Only published listings ever reach the buyer-facing catalog (section 46) - a product pending
 * or rejected in moderation is still visible to its own supplier and to admins, just not through
 * this query.
 *
 * Paginated (Phase 17, section 11) - a real, measured benchmark against a 1000-product scratch
 * fixture found this unpaginated query taking ~114ms average and returning a ~480KB response
 * (vs. ~30ms/~12KB for every already-paginated endpoint) - see PHASE17_FINAL_REPORT.md's
 * Performance Measurements section. `relevance` (the default/no explicit `sortBy`) now sorts by
 * `createdAt desc` rather than leaving `orderBy: {}` (database-default, unspecified order) -
 * fixing a latent correctness bug this pagination work surfaced: an unordered `findMany` makes
 * offset pagination unstable, since Postgres doesn't guarantee any particular row order across
 * repeated queries without an explicit ORDER BY.
 */
export async function listProducts(filters: ProductFilters, pagination: PaginationParams): Promise<ServiceResult<Page<Product>>> {
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
          : { createdAt: 'desc' };

  const [products, total] = await Promise.all([
    db.product.findMany({ where, orderBy, include: PRODUCT_INCLUDE, skip: pagination.skip, take: pagination.take }),
    db.product.count({ where }),
  ]);
  return ok(toPage(products.map(toProductDto), total, pagination));
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

export interface SupplierFilters {
  /** Matched against the supplier's own `categories` string array - which holds display names
   *  ("Networking", "Office Equipment"), not slugs, since a supplier's declared specialties
   *  aren't tied to the Category table the way a product's categoryId is. */
  category?: string;
  search?: string;
}

/** The buyer-facing supplier directory - only ever VERIFIED/PREMIUM_VERIFIED suppliers (section
 *  46) - a supplier still PENDING_VERIFICATION or SUSPENDED can't be found, invited to an RFQ,
 *  or bought from until an admin verifies them. */
export async function listSuppliers(filters: SupplierFilters = {}): Promise<ServiceResult<SupplierProfile[]>> {
  const text = filters.search?.trim();
  const suppliers = await db.supplierProfile.findMany({
    where: {
      verification: { in: ['VERIFIED', 'PREMIUM_VERIFIED'] },
      ...(filters.category ? { categories: { has: filters.category } } : {}),
      ...(text
        ? { OR: [{ name: { contains: text, mode: 'insensitive' } }, { description: { contains: text, mode: 'insensitive' } }] }
        : {}),
    },
    orderBy: { rating: 'desc' },
  });
  return ok(suppliers.map(toSupplierProfileDto));
}

/** Every supplier regardless of verification status - the admin verification queue (section 46)
 *  reads this, not the buyer-facing listSuppliers. */
export async function listAllSuppliers(): Promise<ServiceResult<SupplierProfile[]>> {
  // SupplierProfile has no createdAt of its own to order a "newest first" queue by - name is
  // at least stable and predictable for an admin scanning the full list.
  const suppliers = await db.supplierProfile.findMany({ orderBy: { name: 'asc' } });
  return ok(suppliers.map(toSupplierProfileDto));
}

export async function getSupplierBySlug(slug: string): Promise<ServiceResult<SupplierProfile>> {
  const supplier = await db.supplierProfile.findUnique({ where: { slug } });
  if (!supplier) return fail('NOT_FOUND', 'That supplier could not be found.');
  return ok(toSupplierProfileDto(supplier));
}

export async function getSupplierById(id: UUID): Promise<ServiceResult<SupplierProfile>> {
  const supplier = await db.supplierProfile.findUnique({ where: { id } });
  if (!supplier) return fail('NOT_FOUND', 'That supplier could not be found.');
  return ok(toSupplierProfileDto(supplier));
}

export async function verifySupplier(
  supplierId: UUID,
  decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED',
  actor: { id: string; name: string },
): Promise<ServiceResult<SupplierProfile>> {
  const existing = await db.supplierProfile.findUnique({ where: { id: supplierId } });
  if (!existing) return fail('NOT_FOUND', 'That supplier could not be found.');

  const supplier = await db.supplierProfile.update({ where: { id: supplierId }, data: { verification: decision } });

  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SUPPLIER_VERIFICATION_CHANGED',
    entityType: 'SupplierProfile',
    entityId: supplierId,
    previousValue: { verification: existing.verification },
    newValue: { verification: decision },
  });

  return ok(toSupplierProfileDto(supplier));
}
