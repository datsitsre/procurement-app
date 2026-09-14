// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { getBuyerAnalytics, getPlatformAnalytics, getSupplierAnalytics } from './analytics.service';

/**
 * Phase 14, Stage 10 - real, database-backed regression suite for analytics aggregation. Runs
 * against the actual dev Postgres database, scoped to a dedicated test buyer/supplier/category/
 * product this suite creates and cleans up in `afterAll` - never touches seeded demo data (every
 * assertion checks "our own numbers are in there somewhere", never an exact total, since platform
 * analytics necessarily sees the real seed data too).
 */

const TEST_COMPANY_ID = `test-company-analytics-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-analytics-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-analytics-${Date.now()}`;
const TEST_PRODUCT_ID = `test-product-analytics-${Date.now()}`;
const TEST_COST_CENTER_ID = `test-cc-analytics-${Date.now()}`;

async function createPaidOrder(overrides: { department?: string; costCenterId?: string; unitPrice?: number } = {}) {
  return db.order.create({
    data: {
      reference: `ORD-ANALYTICS-${Date.now()}-${Math.random()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      department: overrides.department,
      costCenterId: overrides.costCenterId,
      subtotal: 1000,
      tax: 125,
      deliveryFee: 2000,
      total: 3125,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      deliveryLocation: 'Accra',
      items: { create: [{ productId: TEST_PRODUCT_ID, productName: 'Analytics Test Widget', quantity: 1, unitPrice: overrides.unitPrice ?? 1000 }] },
    },
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Analytics Test Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Analytics Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Analytics Test Supplier',
      slug: `analytics-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Analytics Test Category', slug: `analytics-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: TEST_PRODUCT_ID,
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Analytics Test Widget',
      slug: `analytics-test-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 1200, // above the order line's unitPrice, so estimatedSavings has something real to find
      moq: 1,
    },
  });
  await db.costCenter.create({ data: { id: TEST_COST_CENTER_ID, companyId: TEST_COMPANY_ID, code: 'AN-01', name: 'Analytics Cost Center' } });
});

afterAll(async () => {
  await db.orderItem.deleteMany({ where: { order: { companyId: TEST_COMPANY_ID } } });
  await db.order.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.costCenter.delete({ where: { id: TEST_COST_CENTER_ID } }).catch(() => undefined);
  await db.product.delete({ where: { id: TEST_PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('getBuyerAnalytics', () => {
  it('aggregates spend by supplier/department/cost-center, status, and estimated savings from real orders only', async () => {
    await createPaidOrder({ department: 'IT', costCenterId: TEST_COST_CENTER_ID, unitPrice: 1000 });
    await createPaidOrder({ department: 'IT', costCenterId: TEST_COST_CENTER_ID, unitPrice: 1000 });

    const result = await getBuyerAnalytics(TEST_COMPANY_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totalOrders).toBe(2);
    expect(result.data.totalSpend).toBe(6250); // 2 * 3125
    expect(result.data.spendBySupplier.find((p) => p.label === 'Analytics Test Supplier')?.value).toBe(6250);
    expect(result.data.spendByDepartment.find((p) => p.label === 'IT')?.value).toBe(6250);
    expect(result.data.spendByCostCenter.find((p) => p.label === 'AN-01')?.value).toBe(6250);
    expect(result.data.ordersByStatus.find((s) => s.status === 'DELIVERED')?.count).toBe(2);
    // Product basePrice 1200, ordered at 1000, quantity 1, twice: (1200-1000)*1*2 = 400.
    expect(result.data.estimatedSavings).toBe(400);
    expect(result.data.monthlySpend.reduce((sum, p) => sum + p.value, 0)).toBeGreaterThanOrEqual(6250);
  });
});

describe('getSupplierAnalytics', () => {
  it('aggregates revenue by buyer and order status for this supplier only', async () => {
    await createPaidOrder({});

    const result = await getSupplierAnalytics(TEST_SUPPLIER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totalOrders).toBeGreaterThanOrEqual(1);
    expect(result.data.revenueByBuyer.find((p) => p.label === 'Analytics Test Buyer Co')).toBeDefined();
    expect(result.data.ordersByStatus.some((s) => s.status === 'DELIVERED')).toBe(true);
  });
});

describe('getPlatformAnalytics', () => {
  it("includes this suite's own orders in the platform-wide GMV, never just the seed data", async () => {
    const result = await getPlatformAnalytics();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.gmvBySupplier.find((p) => p.label === 'Analytics Test Supplier')).toBeDefined();
    expect(result.data.gmvByBuyerCompany.find((p) => p.label === 'Analytics Test Buyer Co')).toBeDefined();
    expect(result.data.totalOrders).toBeGreaterThan(0);
  });
});
