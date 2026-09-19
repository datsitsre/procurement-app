// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { clear, getCart, removeItem, setQuantity } from './cart.service';

/**
 * Phase 14, Stage 7 - real, database-backed regression suite for the cart. Runs against the
 * actual dev Postgres database, scoped to a dedicated test company/supplier/category/product
 * this suite creates and cleans up in `afterAll` - never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-cart-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-cart-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-cart-${Date.now()}`;
const TEST_PRODUCT_ID = `test-product-cart-${Date.now()}`;

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Cart Test Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Cart Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Cart Test Supplier',
      slug: `cart-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Cart Test Category', slug: `cart-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: TEST_PRODUCT_ID,
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Cart Test Widget',
      slug: `cart-test-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 5,
      priceTiers: { create: [{ minQty: 20, maxQty: undefined, unitPrice: 80 }] },
    },
  });
});

afterAll(async () => {
  await db.cartItem.deleteMany({ where: { cart: { companyId: TEST_COMPANY_ID } } });
  await db.cart.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.product.delete({ where: { id: TEST_PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('getCart', () => {
  it('lazily creates an empty cart for a company that has never had one', async () => {
    const result = await getCart(TEST_COMPANY_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.companyId).toBe(TEST_COMPANY_ID);
      expect(result.data.items).toEqual([]);
    }
  });
});

describe('setQuantity', () => {
  it('rejects a quantity below the product MOQ', async () => {
    const result = await setQuantity(TEST_COMPANY_ID, TEST_PRODUCT_ID, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BELOW_MOQ');
  });

  it('adds an item at the base price, then re-resolves the tier price as quantity crosses a threshold', async () => {
    const added = await setQuantity(TEST_COMPANY_ID, TEST_PRODUCT_ID, 5);
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(added.data.items).toHaveLength(1);
      expect(added.data.items[0].unitPrice).toBe(100);
      expect(added.data.items[0].quantity).toBe(5);
    }

    const tiered = await setQuantity(TEST_COMPANY_ID, TEST_PRODUCT_ID, 25);
    expect(tiered.ok).toBe(true);
    if (tiered.ok) {
      expect(tiered.data.items).toHaveLength(1);
      expect(tiered.data.items[0].unitPrice).toBe(80);
      expect(tiered.data.items[0].quantity).toBe(25);
    }
  });

  it('removes the line when quantity is set to 0, and removeItem does the same', async () => {
    await setQuantity(TEST_COMPANY_ID, TEST_PRODUCT_ID, 10);
    const zeroed = await setQuantity(TEST_COMPANY_ID, TEST_PRODUCT_ID, 0);
    expect(zeroed.ok).toBe(true);
    if (zeroed.ok) expect(zeroed.data.items).toHaveLength(0);

    await setQuantity(TEST_COMPANY_ID, TEST_PRODUCT_ID, 10);
    const removed = await removeItem(TEST_COMPANY_ID, TEST_PRODUCT_ID);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.data.items).toHaveLength(0);
  });
});

describe('clear', () => {
  it('empties every item in the cart', async () => {
    await setQuantity(TEST_COMPANY_ID, TEST_PRODUCT_ID, 10);
    const cleared = await clear(TEST_COMPANY_ID);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.data.items).toHaveLength(0);

    const reread = await getCart(TEST_COMPANY_ID);
    expect(reread.ok).toBe(true);
    if (reread.ok) expect(reread.data.items).toHaveLength(0);
  });
});
