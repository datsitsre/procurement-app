import { apiRequest } from './base';
import type { Role } from '@/config/rbac';
import type { Page, ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Category, Product, SupplierProfile, Warehouse } from '@/types/catalog';
import type { PlatformOrgMember } from './company.service';

/** One row of the platform Suppliers management table - see server/services/catalog.service.ts's
 *  own PlatformSupplierRow for exactly which fields this is and isn't. */
export interface PlatformSupplierRow extends SupplierProfile {
  productCount: number;
  memberCount: number;
  joinedAt: string;
}

export interface NewPlatformSupplierInput {
  name: string;
  city: string;
  country: string;
  currency: string;
  description: string;
  logoUrl?: string;
  categories?: string[];
  certifications?: string[];
}

export interface PlatformSupplierUpdateInput {
  name?: string;
  city?: string;
  country?: string;
  description?: string;
  logoUrl?: string;
  categories?: string[];
  certifications?: string[];
}

/** Who performed a mutating action - threaded through from the caller's session so the audit
 *  log records a real name, not a role label. */
export interface Actor {
  id: UUID;
  name: string;
}

// ---------------------------------------------------------------------------------------------
// Suppliers - real (server/services/catalog.service.ts's listSuppliers/listAllSuppliers/
// getSupplierBySlug/verifySupplier), same as products/categories/warehouses. The one thing that
// couldn't move wholesale: getSupplierById/getSupplierByCompanyId are *synchronous* (~16 call
// sites across this app read supplier data that way), which a network-backed service can't
// serve directly without a caching layer. A cache built lazily from whichever list/detail call
// happened to run is fine for the true *display* lookups (a supplier's name next to a quote),
// but every getSupplierByCompanyId(activeCompany.id) call site - the supplier dashboard, the
// Products & Inventory page, and six others - resolves the CALLER'S OWN supplier profile, and a
// cold cache there doesn't just show a blank name, it makes the whole page render nothing. That
// case is handled properly: useAuth.tsx's AuthProvider calls primeSupplierCache() with every
// company's full SupplierProfile the moment a session loads (see server/dto/session.ts -
// buildSessionPayload embeds it directly, the same join server/auth/context.ts's resolveTenant
// already does server-side) - so the caller's own profile is warm before any page using it can
// even render, never dependent on some other page having fetched a supplier list first.
// ---------------------------------------------------------------------------------------------

const supplierCache = new Map<UUID, SupplierProfile>();

function cacheSuppliers(suppliers: SupplierProfile[]): void {
  for (const s of suppliers) supplierCache.set(s.id, s);
}

/** Seeds the cache getSupplierById/getSupplierByCompanyId read from, with data that's already
 *  known rather than fetched - every company on the session (useAuth.tsx's AuthProvider, right
 *  after login/session-load) and, incidentally, every result any real listSuppliers/
 *  listAllSuppliers/getSupplierBySlug call returns (see cacheSuppliers above, which this wraps). */
export function primeSupplierCache(suppliers: SupplierProfile[]): void {
  cacheSuppliers(suppliers);
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

export interface SupplierFilters {
  /** Matches against the supplier's own declared `categories` (display names, not slugs). */
  category?: string;
  search?: string;
}

export interface CatalogService {
  listCategories(): Promise<ServiceResult<Category[]>>;
  listProducts(filters?: ProductFilters, page?: number, pageSize?: number): Promise<ServiceResult<Page<Product>>>;
  getProductBySlug(slug: string): Promise<ServiceResult<Product>>;
  getProductById(id: UUID): Promise<ServiceResult<Product>>;
  listSuppliers(filters?: SupplierFilters): Promise<ServiceResult<SupplierProfile[]>>;
  /** Every supplier regardless of verification status - the admin verification queue (section
   *  46) reads this, not the buyer-facing `listSuppliers`. */
  listAllSuppliers(): Promise<ServiceResult<SupplierProfile[]>>;
  /** The richer Platform Suppliers management table (Phase 27) - same suppliers, plus
   *  productCount/memberCount/joinedAt for display. Separate from `listAllSuppliers` so the
   *  plain admin verification queue keeps its existing, unchanged shape. */
  listAllSuppliersForAdmin(): Promise<ServiceResult<PlatformSupplierRow[]>>;

  /** Creates a new supplier as a platform administrator (Phase 28) -
   *  POST /api/admin/suppliers, PLATFORM_SUPPLIERS_CREATE. */
  createSupplierAsPlatformAdmin(input: NewPlatformSupplierInput): Promise<ServiceResult<SupplierProfile>>;

  /** Edits an existing supplier's profile as a platform administrator (Phase 28) -
   *  PATCH /api/admin/suppliers/[supplierId], PLATFORM_SUPPLIERS_UPDATE. Never touches
   *  verification status - see `verifySupplier` for that. */
  updateSupplierAsPlatformAdmin(supplierId: UUID, patch: PlatformSupplierUpdateInput): Promise<ServiceResult<SupplierProfile>>;

  /** A specific supplier's own member list, from the platform admin side (Phase 28) -
   *  GET /api/admin/suppliers/[supplierId]/members, PLATFORM_MEMBERS_VIEW. */
  listSupplierMembersAsPlatformAdmin(supplierId: UUID): Promise<ServiceResult<PlatformOrgMember[]>>;
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
 * `/api/suppliers/[supplierId]/*` backend (Phase 14, Stage 4); suppliers themselves call the
 * real `/api/suppliers*` backend too (see the block comment above `supplierCache`).
 * `callerRole`/`caller` are still accepted by every mutation (every existing page already passes
 * them) but are never sent over the wire - the API derives the caller's role and tenant
 * (supplierId) from the session cookie itself.
 */
class ApiCatalogService implements CatalogService {
  async listCategories(): Promise<ServiceResult<Category[]>> {
    return apiRequest<Category[]>('/api/categories');
  }

  async listProducts(filters: ProductFilters = {}, page = 1, pageSize = 25): Promise<ServiceResult<Page<Product>>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters.categorySlug) params.set('categorySlug', filters.categorySlug);
    if (filters.supplierId) params.set('supplierId', filters.supplierId);
    if (filters.search) params.set('search', filters.search);
    if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
    if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
    if (filters.sortBy) params.set('sortBy', filters.sortBy);
    return apiRequest<Page<Product>>(`/api/products?${params.toString()}`);
  }

  async getProductBySlug(slug: string): Promise<ServiceResult<Product>> {
    return apiRequest<Product>(`/api/products/slug/${encodeURIComponent(slug)}`);
  }

  async getProductById(id: UUID): Promise<ServiceResult<Product>> {
    return apiRequest<Product>(`/api/products/${id}`);
  }

  async listSuppliers(filters: SupplierFilters = {}): Promise<ServiceResult<SupplierProfile[]>> {
    const params = new URLSearchParams();
    if (filters.category) params.set('category', filters.category);
    if (filters.search) params.set('search', filters.search);
    const query = params.toString();
    const result = await apiRequest<SupplierProfile[]>(`/api/suppliers${query ? `?${query}` : ''}`);
    if (result.ok) cacheSuppliers(result.data);
    return result;
  }

  async listAllSuppliers(): Promise<ServiceResult<SupplierProfile[]>> {
    const result = await apiRequest<SupplierProfile[]>('/api/suppliers/moderation');
    if (result.ok) cacheSuppliers(result.data);
    return result;
  }

  async listAllSuppliersForAdmin(): Promise<ServiceResult<PlatformSupplierRow[]>> {
    const result = await apiRequest<PlatformSupplierRow[]>('/api/admin/suppliers');
    if (result.ok) cacheSuppliers(result.data);
    return result;
  }

  async createSupplierAsPlatformAdmin(input: NewPlatformSupplierInput): Promise<ServiceResult<SupplierProfile>> {
    return apiRequest<SupplierProfile>('/api/admin/suppliers', { method: 'POST', body: JSON.stringify(input) });
  }

  async updateSupplierAsPlatformAdmin(supplierId: UUID, patch: PlatformSupplierUpdateInput): Promise<ServiceResult<SupplierProfile>> {
    return apiRequest<SupplierProfile>(`/api/admin/suppliers/${supplierId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  async listSupplierMembersAsPlatformAdmin(supplierId: UUID): Promise<ServiceResult<PlatformOrgMember[]>> {
    return apiRequest<PlatformOrgMember[]>(`/api/admin/suppliers/${supplierId}/members`);
  }

  async getSupplierBySlug(slug: string): Promise<ServiceResult<SupplierProfile>> {
    const result = await apiRequest<SupplierProfile>(`/api/suppliers/slug/${encodeURIComponent(slug)}`);
    if (result.ok) cacheSuppliers([result.data]);
    return result;
  }

  getSupplierById(id: string): SupplierProfile | undefined {
    return supplierCache.get(id);
  }

  getSupplierByCompanyId(companyId: UUID): SupplierProfile | undefined {
    return [...supplierCache.values()].find((s) => s.companyId === companyId);
  }

  async verifySupplier(supplierId: UUID, decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED'): Promise<ServiceResult<SupplierProfile>> {
    const result = await apiRequest<SupplierProfile>(`/api/suppliers/${supplierId}/verification`, {
      method: 'PATCH',
      body: JSON.stringify({ decision }),
    });
    if (result.ok) cacheSuppliers([result.data]);
    return result;
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
