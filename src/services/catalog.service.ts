import { delay, ok, fail } from './base';
import { demoCategories, demoProducts, demoSuppliers } from '@/lib/demo-data/catalog';
import type { ServiceResult } from '@/types/common';
import type { Category, Product, SupplierProfile } from '@/types/catalog';

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
  listSuppliers(): Promise<ServiceResult<SupplierProfile[]>>;
  getSupplierBySlug(slug: string): Promise<ServiceResult<SupplierProfile>>;
  getSupplierById(id: string): SupplierProfile | undefined;
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

    let results = demoProducts.filter((p) => {
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
    const product = demoProducts.find((p) => p.slug === slug);
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
}

export const catalogService: CatalogService = new MockCatalogService();
