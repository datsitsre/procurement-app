// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  createProduct,
  getProductById,
  listCategories,
  listProducts,
  moderateProduct,
  updateInventory,
  updateProduct,
} from './catalog.service';

/**
 * Phase 14, Stage 4 - real, database-backed regression suite for products/categories/warehouses.
 * Runs against the actual dev Postgres database, scoped to a dedicated test supplier + category
 * this suite creates and cleans up in `afterAll` - never touches seeded demo data.
 */

const TEST_SUPPLIER_ID = `test-supplier-catalog-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-catalog-${Date.now()}`;
const TEST_WAREHOUSE_ID = `test-warehouse-catalog-${Date.now()}`;

beforeAll(async () => {
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Catalog Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Catalog Test Supplier',
      slug: `catalog-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Test Category', slug: `test-category-${Date.now()}` } });
  await db.warehouse.create({ data: { id: TEST_WAREHOUSE_ID, supplierId: TEST_SUPPLIER_ID, name: 'Test Warehouse', city: 'Accra' } });
});

afterAll(async () => {
  await db.product.deleteMany({ where: { supplierId: TEST_SUPPLIER_ID } });
  await db.warehouse.delete({ where: { id: TEST_WAREHOUSE_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
});

describe('Categories', () => {
  it('lists categories', async () => {
    const result = await listCategories();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.some((c) => c.id === TEST_CATEGORY_ID)).toBe(true);
  });
});

describe('Products', () => {
  it('rejects a product with no name', async () => {
    const result = await createProduct({
      supplierId: TEST_SUPPLIER_ID,
      name: '   ',
      brand: 'x',
      sku: 'x',
      categoryId: TEST_CATEGORY_ID,
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      warehouseId: TEST_WAREHOUSE_ID,
      stock: 10,
      lowStockThreshold: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it('rejects a non-positive base price', async () => {
    const result = await createProduct({
      supplierId: TEST_SUPPLIER_ID,
      name: 'Test Widget',
      brand: 'x',
      sku: 'x',
      categoryId: TEST_CATEGORY_ID,
      description: 'x',
      currency: 'GHS',
      basePrice: 0,
      moq: 1,
      warehouseId: TEST_WAREHOUSE_ID,
      stock: 10,
      lowStockThreshold: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_PRICE');
  });

  it('creates a product as PENDING_REVIEW, invisible to the buyer-facing catalog until moderated', async () => {
    const created = await createProduct({
      supplierId: TEST_SUPPLIER_ID,
      name: 'Test Widget',
      brand: 'TestBrand',
      sku: 'TW-001',
      categoryId: TEST_CATEGORY_ID,
      description: 'A widget for testing.',
      currency: 'GHS',
      basePrice: 500,
      moq: 1,
      warehouseId: TEST_WAREHOUSE_ID,
      stock: 20,
      lowStockThreshold: 5,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.moderationStatus).toBe('PENDING_REVIEW');
    expect(created.data.inventory).toHaveLength(1);
    expect(created.data.inventory[0].stock).toBe(20);

    const buyerFacing = await listProducts({ supplierId: TEST_SUPPLIER_ID });
    expect(buyerFacing.ok).toBe(true);
    if (buyerFacing.ok) expect(buyerFacing.data.some((p) => p.id === created.data.id)).toBe(false);

    // Once published, it appears in the buyer-facing catalog. actorId must be a real User id -
    // AuditLog.actorId is a genuine FK - so this uses the seeded platform admin (prisma/seed.ts).
    const moderated = await moderateProduct(created.data.id, 'PUBLISHED', undefined, { id: 'user-grace-owusu', name: 'Grace Owusu' });
    expect(moderated.ok).toBe(true);
    const afterPublish = await listProducts({ supplierId: TEST_SUPPLIER_ID });
    expect(afterPublish.ok).toBe(true);
    if (afterPublish.ok) expect(afterPublish.data.some((p) => p.id === created.data.id)).toBe(true);
  });

  it("refuses updating a product scoped to a different supplier (the where clause enforces it)", async () => {
    const created = await createProduct({
      supplierId: TEST_SUPPLIER_ID,
      name: 'Ownership Test Widget',
      brand: 'x',
      sku: 'x',
      categoryId: TEST_CATEGORY_ID,
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      warehouseId: TEST_WAREHOUSE_ID,
      stock: 5,
      lowStockThreshold: 1,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wrongSupplier = await updateProduct(created.data.id, 'supplier-not-mine', { basePrice: 1 });
    expect(wrongSupplier.ok).toBe(false);
    if (!wrongSupplier.ok) expect(wrongSupplier.error.code).toBe('NOT_FOUND');

    const stillOriginalPrice = await getProductById(created.data.id);
    expect(stillOriginalPrice.ok).toBe(true);
    if (stillOriginalPrice.ok) expect(stillOriginalPrice.data.basePrice).toBe(100);

    const rightSupplier = await updateProduct(created.data.id, TEST_SUPPLIER_ID, { basePrice: 150 });
    expect(rightSupplier.ok).toBe(true);
    if (rightSupplier.ok) expect(rightSupplier.data.basePrice).toBe(150);
  });

  it('adds a new inventory record for a warehouse the product is not yet stocked at', async () => {
    const created = await createProduct({
      supplierId: TEST_SUPPLIER_ID,
      name: 'Multi-warehouse Widget',
      brand: 'x',
      sku: 'x',
      categoryId: TEST_CATEGORY_ID,
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      warehouseId: TEST_WAREHOUSE_ID,
      stock: 5,
      lowStockThreshold: 1,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const secondWarehouse = await db.warehouse.create({
      data: { supplierId: TEST_SUPPLIER_ID, name: 'Second Warehouse', city: 'Kumasi' },
    });

    const updated = await updateInventory(created.data.id, TEST_SUPPLIER_ID, secondWarehouse.id, { stock: 30 });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.data.inventory).toHaveLength(2);

    await db.warehouse.delete({ where: { id: secondWarehouse.id } });
  });
});
