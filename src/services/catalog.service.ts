import { assertPermission, delay, ok, fail, ownsRecord } from './base';
import { auditLogService } from './audit-log.service';
import { demoCategories, demoProducts, demoSuppliers, demoWarehouses } from '@/lib/demo-data/catalog';
import { Permission, type Role } from '@/config/rbac';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Category, Product, SupplierProfile, Warehouse } from '@/types/catalog';

/** Who performed a mutating action - threaded through from the caller's session so the audit
 *  log records a real name, not a role label. */
export interface Actor {
  id: UUID;
  name: string;
}

const PRODUCT_OVERRIDE_KEY = 'catalog.products.v1.overrides';
const PRODUCT_CREATED_KEY = 'catalog.products.v1.created';
const SUPPLIER_OVERRIDE_KEY = 'catalog.suppliers.v1.overrides';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

/** Overrides keyed by product id - lets a supplier edit a *seeded* demo product (price, stock,
 *  MOQ) without duplicating it into a separate created list, the same pattern every other mock
 *  service in this app uses for editing seed data in place. */
function readOverrides(): Record<UUID, Product> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(PRODUCT_OVERRIDE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, Product>;
  } catch {
    return {};
  }
}

function writeOverride(product: Product) {
  if (typeof window === 'undefined') return;
  const store = readOverrides();
  store[product.id] = product;
  window.localStorage.setItem(PRODUCT_OVERRIDE_KEY, JSON.stringify(store));
}

function readCreated(): Product[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(PRODUCT_CREATED_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Product[];
  } catch {
    return [];
  }
}

function appendCreated(product: Product) {
  if (typeof window === 'undefined') return;
  const list = readCreated();
  list.push(product);
  window.localStorage.setItem(PRODUCT_CREATED_KEY, JSON.stringify(list));
}

function allProducts(): Product[] {
  const overrides = readOverrides();
  const seeded = demoProducts.map((p) => overrides[p.id] ?? p);
  const created = readCreated().map((p) => overrides[p.id] ?? p);
  return [...seeded, ...created];
}

function readSupplierOverrides(): Record<UUID, SupplierProfile> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(SUPPLIER_OVERRIDE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, SupplierProfile>;
  } catch {
    return {};
  }
}

function writeSupplierOverride(supplier: SupplierProfile) {
  if (typeof window === 'undefined') return;
  const store = readSupplierOverrides();
  store[supplier.id] = supplier;
  window.localStorage.setItem(SUPPLIER_OVERRIDE_KEY, JSON.stringify(store));
}

function allSuppliers(): SupplierProfile[] {
  const overrides = readSupplierOverrides();
  return demoSuppliers.map((s) => overrides[s.id] ?? s);
}

export interface NewProductInput {
  name: string;
  brand: string;
  sku: string;
  supplierId: UUID;
  categoryId: UUID;
  description: string;
  currency: Product['currency'];
  basePrice: number;
  moq: number;
  warehouseId: UUID;
  stock: number;
  lowStockThreshold: number;
}

export interface ProductPatch {
  name?: string;
  basePrice?: number;
  moq?: number;
  description?: string;
}

export interface ProductFilters {
  categorySlug?: string;
  supplierId?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: 'relevance' | 'priceAsc' | 'priceDesc' | 'rating';
}

export interface CatalogService {
  listCategories(): Promise<ServiceResult<Category[]>>;
  listProducts(filters?: ProductFilters): Promise<ServiceResult<Product[]>>;
  getProductBySlug(slug: string): Promise<ServiceResult<Product>>;
  getProductById(id: UUID): Promise<ServiceResult<Product>>;
  /** Synchronous counterpart to `getProductById` - the storage read behind it is already
   *  synchronous (the async wrapper only simulates network latency), so a caller that needs a
   *  product mid-render (useCart.tsx's line pricing) can read it directly instead of juggling
   *  an effect just to reach the same override-aware data `getProductById` already returns. */
  getProductByIdSync(id: UUID): Product | undefined;
  listSuppliers(): Promise<ServiceResult<SupplierProfile[]>>;
  /** Every supplier regardless of verification status - the admin verification queue (section
   *  46) reads this, not the buyer-facing `listSuppliers`. */
  listAllSuppliers(): Promise<ServiceResult<SupplierProfile[]>>;
  getSupplierBySlug(slug: string): Promise<ServiceResult<SupplierProfile>>;
  getSupplierById(id: string): SupplierProfile | undefined;
  getSupplierByCompanyId(companyId: UUID): SupplierProfile | undefined;
  /** Verifies, suspends, or rejects a supplier - only VERIFIED/PREMIUM_VERIFIED suppliers ever
   *  reach the buyer-facing directory or RFQ invite list. */
  verifySupplier(
    supplierId: UUID,
    decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED',
    callerRole: Role,
    actor: Actor,
  ): Promise<ServiceResult<SupplierProfile>>;
  /** A supplier's own listing, for the Products & Inventory page (section 34). */
  listProductsForSupplier(supplierId: UUID): Promise<ServiceResult<Product[]>>;
  listWarehousesForSupplier(supplierId: UUID): Promise<ServiceResult<Warehouse[]>>;
  /** `caller.supplierId` must match `input.supplierId` (section 9.2) - otherwise any supplier
   *  account could create a listing attributed to a competitor's supplier id. */
  createProduct(input: NewProductInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Product>>;
  /** `caller` must own the product being edited (its supplierId) or be a platform admin -
   *  PRODUCTS_MANAGE alone only proves the role can manage *some* supplier's products, not that
   *  this one is theirs (section 9.2/9.3's "supplier modifying another supplier's product"). */
  updateProduct(productId: UUID, patch: ProductPatch, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Product>>;
  /** Every product across every supplier, unfiltered by moderation status - the admin
   *  product-moderation queue (section 46) reads this, not the buyer-facing `listProducts`. */
  listAllProductsForModeration(): Promise<ServiceResult<Product[]>>;
  /** Publishes or rejects a product awaiting moderation - a rejected listing stays visible to
   *  its supplier (with `moderationNote` explaining why) but never reaches the buyer catalog. */
  moderateProduct(
    productId: UUID,
    decision: 'PUBLISHED' | 'REJECTED',
    note: string | undefined,
    callerRole: Role,
    actor: Actor,
  ): Promise<ServiceResult<Product>>;
  /** Adjusts stock/threshold at one warehouse (section 35) - adds the warehouse's inventory
   *  record if the product isn't stocked there yet. */
  updateInventory(
    productId: UUID,
    warehouseId: UUID,
    patch: { stock?: number; lowStockThreshold?: number },
    callerRole: Role,
    caller: TenantContext,
  ): Promise<ServiceResult<Product>>;
}

class MockCatalogService implements CatalogService {
  async listCategories(): Promise<ServiceResult<Category[]>> {
    await delay(150);
    return ok(demoCategories);
  }

  async listProducts(filters: ProductFilters = {}): Promise<ServiceResult<Product[]>> {
    await delay(300);
    const category = filters.categorySlug ? demoCategories.find((c) => c.slug === filters.categorySlug) : undefined;
    const text = filters.search?.trim().toLowerCase();

    let results = allProducts().filter((p) => {
      // Only published listings ever reach the buyer-facing catalog (section 46) - a product
      // pending or rejected in moderation is still visible to its own supplier and to admins,
      // just not here.
      if (p.moderationStatus !== 'PUBLISHED') return false;
      if (category && p.categoryId !== category.id) return false;
      if (filters.supplierId && p.supplierId !== filters.supplierId) return false;
      if (text && !p.name.toLowerCase().includes(text) && !p.brand.toLowerCase().includes(text) && !p.sku.toLowerCase().includes(text)) {
        return false;
      }
      if (filters.minPrice !== undefined && p.basePrice < filters.minPrice) return false;
      if (filters.maxPrice !== undefined && p.basePrice > filters.maxPrice) return false;
      return true;
    });

    switch (filters.sortBy) {
      case 'priceAsc':
        results = results.slice().sort((a, b) => a.basePrice - b.basePrice);
        break;
      case 'priceDesc':
        results = results.slice().sort((a, b) => b.basePrice - a.basePrice);
        break;
      case 'rating':
        results = results.slice().sort((a, b) => b.rating - a.rating);
        break;
      default:
        break;
    }

    return ok(results);
  }

  async getProductBySlug(slug: string): Promise<ServiceResult<Product>> {
    await delay(250);
    const product = allProducts().find((p) => p.slug === slug);
    if (!product) return fail('NOT_FOUND', 'That product could not be found.');
    return ok(product);
  }

  async getProductById(id: UUID): Promise<ServiceResult<Product>> {
    await delay(200);
    const product = allProducts().find((p) => p.id === id);
    if (!product) return fail('NOT_FOUND', 'That product could not be found.');
    return ok(product);
  }

  getProductByIdSync(id: UUID): Product | undefined {
    return allProducts().find((p) => p.id === id);
  }

  async listSuppliers(): Promise<ServiceResult<SupplierProfile[]>> {
    await delay(250);
    // The buyer-facing supplier directory only ever shows verified suppliers (section 46) - a
    // supplier still PENDING_VERIFICATION or SUSPENDED can't be found, invited to an RFQ, or
    // bought from until an admin verifies them.
    return ok(allSuppliers().filter((s) => s.verification === 'VERIFIED' || s.verification === 'PREMIUM_VERIFIED'));
  }

  async listAllSuppliers(): Promise<ServiceResult<SupplierProfile[]>> {
    await delay(250);
    return ok(allSuppliers());
  }

  async getSupplierBySlug(slug: string): Promise<ServiceResult<SupplierProfile>> {
    await delay(250);
    const supplier = allSuppliers().find((s) => s.slug === slug);
    if (!supplier) return fail('NOT_FOUND', 'That supplier could not be found.');
    return ok(supplier);
  }

  getSupplierById(id: string): SupplierProfile | undefined {
    return allSuppliers().find((s) => s.id === id);
  }

  getSupplierByCompanyId(companyId: UUID): SupplierProfile | undefined {
    return allSuppliers().find((s) => s.companyId === companyId);
  }

  async verifySupplier(
    supplierId: UUID,
    decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED',
    callerRole: Role,
    actor: Actor,
  ): Promise<ServiceResult<SupplierProfile>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PLATFORM_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const supplier = allSuppliers().find((s) => s.id === supplierId);
    if (!supplier) return fail('NOT_FOUND', 'That supplier could not be found.');

    const updated: SupplierProfile = { ...supplier, verification: decision };
    writeSupplierOverride(updated);
    auditLogService.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'SUPPLIER_VERIFICATION_CHANGED',
      entityType: 'Supplier',
      entityId: supplierId,
      previousValue: { verification: supplier.verification },
      newValue: { verification: decision },
    });
    return ok(updated);
  }

  async listProductsForSupplier(supplierId: UUID): Promise<ServiceResult<Product[]>> {
    await delay(250);
    return ok(allProducts().filter((p) => p.supplierId === supplierId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async listWarehousesForSupplier(supplierId: UUID): Promise<ServiceResult<Warehouse[]>> {
    await delay(150);
    return ok(demoWarehouses.filter((w) => w.supplierId === supplierId));
  }

  async createProduct(input: NewProductInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Product>> {
    await delay(350);
    const permissionError = assertPermission(callerRole, Permission.PRODUCTS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, undefined, input.supplierId)) {
      return fail('FORBIDDEN', 'You can only add products under your own supplier account.');
    }
    if (!input.name.trim()) return fail('EMPTY', 'Give the product a name.');
    if (input.basePrice <= 0) return fail('INVALID_PRICE', 'Set a base price greater than zero.');

    const product: Product = {
      id: newId('prod'),
      slug: `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Math.floor(1000 + Math.random() * 8999)}`,
      name: input.name,
      brand: input.brand,
      sku: input.sku,
      supplierId: input.supplierId,
      categoryId: input.categoryId,
      // Every newly-submitted product is held for admin review (section 46) before it can
      // appear in the buyer-facing catalog - see listProducts's moderationStatus filter.
      moderationStatus: 'PENDING_REVIEW',
      images: [],
      description: input.description,
      specifications: [],
      currency: input.currency,
      basePrice: input.basePrice,
      priceTiers: [],
      moq: input.moq,
      inventory: [{ warehouseId: input.warehouseId, stock: input.stock, reserved: 0, lowStockThreshold: input.lowStockThreshold }],
      rating: 0,
      reviewCount: 0,
      createdAt: new Date().toISOString(),
    };
    appendCreated(product);
    return ok(product);
  }

  async updateProduct(productId: UUID, patch: ProductPatch, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Product>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PRODUCTS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const product = allProducts().find((p) => p.id === productId);
    if (!product || !ownsRecord(caller, undefined, product.supplierId)) {
      return fail('NOT_FOUND', 'That product could not be found.');
    }

    const updated: Product = { ...product, ...patch };
    writeOverride(updated);
    return ok(updated);
  }

  async updateInventory(
    productId: UUID,
    warehouseId: UUID,
    patch: { stock?: number; lowStockThreshold?: number },
    callerRole: Role,
    caller: TenantContext,
  ): Promise<ServiceResult<Product>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PRODUCTS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const product = allProducts().find((p) => p.id === productId);
    if (!product || !ownsRecord(caller, undefined, product.supplierId)) {
      return fail('NOT_FOUND', 'That product could not be found.');
    }

    const hasRecord = product.inventory.some((i) => i.warehouseId === warehouseId);
    const inventory = hasRecord
      ? product.inventory.map((i) => (i.warehouseId === warehouseId ? { ...i, ...patch } : i))
      : [...product.inventory, { warehouseId, stock: patch.stock ?? 0, reserved: 0, lowStockThreshold: patch.lowStockThreshold ?? 0 }];

    const updated: Product = { ...product, inventory };
    writeOverride(updated);
    return ok(updated);
  }

  async listAllProductsForModeration(): Promise<ServiceResult<Product[]>> {
    await delay(250);
    return ok(allProducts().slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async moderateProduct(
    productId: UUID,
    decision: 'PUBLISHED' | 'REJECTED',
    note: string | undefined,
    callerRole: Role,
    actor: Actor,
  ): Promise<ServiceResult<Product>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PLATFORM_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const product = allProducts().find((p) => p.id === productId);
    if (!product) return fail('NOT_FOUND', 'That product could not be found.');

    const updated: Product = { ...product, moderationStatus: decision, moderationNote: note };
    writeOverride(updated);
    auditLogService.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'PRODUCT_MODERATED',
      entityType: 'Product',
      entityId: productId,
      previousValue: { moderationStatus: product.moderationStatus },
      newValue: { moderationStatus: decision, note },
    });
    return ok(updated);
  }
}

export const catalogService: CatalogService = new MockCatalogService();
