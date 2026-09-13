import { apiRequest, delay, ok, fail } from './base';
import { auditLogService } from './audit-log.service';
import { demoSuppliers } from '@/lib/demo-data/catalog';
import type { Role } from '@/config/rbac';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Category, Product, SupplierProfile, Warehouse } from '@/types/catalog';

/** Who performed a mutating action - threaded through from the caller's session so the audit
 *  log records a real name, not a role label. */
export interface Actor {
  id: UUID;
  name: string;
}

// ---------------------------------------------------------------------------------------------
// Suppliers - still localStorage-backed (Phase 14, Stage 4 migrated products/categories/
// warehouses only). SupplierProfile now also exists for real in Postgres (Product.supplierId
// is a real FK to it), but ~18 call sites across this app read supplier data through
// *synchronous* accessors (getSupplierById, getSupplierByCompanyId) that a real network-backed
// service can't offer without either a cache-staleness/reactivity problem or a much larger
// refactor than this stage's "smallest coherent increment" - see the Phase 14 session notes.
// Deferred to whichever future stage migrates RFQs/suppliers together.
// ---------------------------------------------------------------------------------------------

const SUPPLIER_OVERRIDE_KEY = 'catalog.suppliers.v1.overrides';

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

/**
 * Products/categories/warehouses call the real `/api/products`, `/api/categories`, and
 * `/api/suppliers/[supplierId]/*` backend (Phase 14, Stage 4). Suppliers themselves stay
 * localStorage-backed (see the block comment above `allSuppliers`). `callerRole`/`caller` are
 * still accepted by every mutation (every existing page already passes them) but are never sent
 * over the wire - the API derives the caller's role and tenant (supplierId) from the session
 * cookie itself.
 */
class ApiCatalogService implements CatalogService {
  async listCategories(): Promise<ServiceResult<Category[]>> {
    return apiRequest<Category[]>('/api/categories');
  }

  async listProducts(filters: ProductFilters = {}): Promise<ServiceResult<Product[]>> {
    const params = new URLSearchParams();
    if (filters.categorySlug) params.set('categorySlug', filters.categorySlug);
    if (filters.supplierId) params.set('supplierId', filters.supplierId);
    if (filters.search) params.set('search', filters.search);
    if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
    if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
    if (filters.sortBy) params.set('sortBy', filters.sortBy);
    const query = params.toString();
    return apiRequest<Product[]>(`/api/products${query ? `?${query}` : ''}`);
  }

  async getProductBySlug(slug: string): Promise<ServiceResult<Product>> {
    return apiRequest<Product>(`/api/products/slug/${encodeURIComponent(slug)}`);
  }

  async getProductById(id: UUID): Promise<ServiceResult<Product>> {
    return apiRequest<Product>(`/api/products/${id}`);
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

  async verifySupplier(supplierId: UUID, decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED', callerRole: Role, actor: Actor): Promise<ServiceResult<SupplierProfile>> {
    await delay(300);
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
    return apiRequest<Product[]>(`/api/suppliers/${supplierId}/products`);
  }

  async listWarehousesForSupplier(supplierId: UUID): Promise<ServiceResult<Warehouse[]>> {
    return apiRequest<Warehouse[]>(`/api/suppliers/${supplierId}/warehouses`);
  }

  async createProduct(input: NewProductInput): Promise<ServiceResult<Product>> {
    return apiRequest<Product>('/api/products', { method: 'POST', body: JSON.stringify(input) });
  }

  async updateProduct(productId: UUID, patch: ProductPatch): Promise<ServiceResult<Product>> {
    return apiRequest<Product>(`/api/products/${productId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  async listAllProductsForModeration(): Promise<ServiceResult<Product[]>> {
    return apiRequest<Product[]>('/api/products/moderation');
  }

  async moderateProduct(productId: UUID, decision: 'PUBLISHED' | 'REJECTED', note: string | undefined): Promise<ServiceResult<Product>> {
    return apiRequest<Product>(`/api/products/${productId}/moderation`, { method: 'PATCH', body: JSON.stringify({ decision, note }) });
  }

  async updateInventory(
    productId: UUID,
    warehouseId: UUID,
    patch: { stock?: number; lowStockThreshold?: number },
  ): Promise<ServiceResult<Product>> {
    return apiRequest<Product>(`/api/products/${productId}/inventory`, { method: 'PATCH', body: JSON.stringify({ warehouseId, ...patch }) });
  }
}

export const catalogService: CatalogService = new ApiCatalogService();
