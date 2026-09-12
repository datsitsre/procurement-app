import { assertPermission, delay, ok, fail } from './base';
import { demoCategories, demoProducts, demoSuppliers, demoWarehouses } from '@/lib/demo-data/catalog';
import { Permission, type Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';
import type { Category, Product, SupplierProfile, Warehouse } from '@/types/catalog';

const PRODUCT_OVERRIDE_KEY = 'catalog.products.v1.overrides';
const PRODUCT_CREATED_KEY = 'catalog.products.v1.created';

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
  getSupplierBySlug(slug: string): Promise<ServiceResult<SupplierProfile>>;
  getSupplierById(id: string): SupplierProfile | undefined;
  getSupplierByCompanyId(companyId: UUID): SupplierProfile | undefined;
  /** A supplier's own listing, for the Products & Inventory page (section 34). */
  listProductsForSupplier(supplierId: UUID): Promise<ServiceResult<Product[]>>;
  listWarehousesForSupplier(supplierId: UUID): Promise<ServiceResult<Warehouse[]>>;
  createProduct(input: NewProductInput, callerRole: Role): Promise<ServiceResult<Product>>;
  updateProduct(productId: UUID, patch: ProductPatch, callerRole: Role): Promise<ServiceResult<Product>>;
  /** Adjusts stock/threshold at one warehouse (section 35) - adds the warehouse's inventory
   *  record if the product isn't stocked there yet. */
  updateInventory(
    productId: UUID,
    warehouseId: UUID,
    patch: { stock?: number; lowStockThreshold?: number },
    callerRole: Role,
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

  async listSuppliers(): Promise<ServiceResult<SupplierProfile[]>> {
    await delay(250);
    return ok(demoSuppliers);
  }

  async getSupplierBySlug(slug: string): Promise<ServiceResult<SupplierProfile>> {
    await delay(250);
    const supplier = demoSuppliers.find((s) => s.slug === slug);
    if (!supplier) return fail('NOT_FOUND', 'That supplier could not be found.');
    return ok(supplier);
  }

  getSupplierById(id: string): SupplierProfile | undefined {
    return demoSuppliers.find((s) => s.id === id);
  }

  getSupplierByCompanyId(companyId: UUID): SupplierProfile | undefined {
    return demoSuppliers.find((s) => s.companyId === companyId);
  }

  async listProductsForSupplier(supplierId: UUID): Promise<ServiceResult<Product[]>> {
    await delay(250);
    return ok(allProducts().filter((p) => p.supplierId === supplierId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async listWarehousesForSupplier(supplierId: UUID): Promise<ServiceResult<Warehouse[]>> {
    await delay(150);
    return ok(demoWarehouses.filter((w) => w.supplierId === supplierId));
  }

  async createProduct(input: NewProductInput, callerRole: Role): Promise<ServiceResult<Product>> {
    await delay(350);
    const permissionError = assertPermission(callerRole, Permission.PRODUCTS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
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

  async updateProduct(productId: UUID, patch: ProductPatch, callerRole: Role): Promise<ServiceResult<Product>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PRODUCTS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const product = allProducts().find((p) => p.id === productId);
    if (!product) return fail('NOT_FOUND', 'That product could not be found.');

    const updated: Product = { ...product, ...patch };
    writeOverride(updated);
    return ok(updated);
  }

  async updateInventory(
    productId: UUID,
    warehouseId: UUID,
    patch: { stock?: number; lowStockThreshold?: number },
    callerRole: Role,
  ): Promise<ServiceResult<Product>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PRODUCTS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const product = allProducts().find((p) => p.id === productId);
    if (!product) return fail('NOT_FOUND', 'That product could not be found.');

    const hasRecord = product.inventory.some((i) => i.warehouseId === warehouseId);
    const inventory = hasRecord
      ? product.inventory.map((i) => (i.warehouseId === warehouseId ? { ...i, ...patch } : i))
      : [...product.inventory, { warehouseId, stock: patch.stock ?? 0, reserved: 0, lowStockThreshold: patch.lowStockThreshold ?? 0 }];

    const updated: Product = { ...product, inventory };
    writeOverride(updated);
    return ok(updated);
  }
}

export const catalogService: CatalogService = new MockCatalogService();
