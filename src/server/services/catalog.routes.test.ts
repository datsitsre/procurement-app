// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { POST as createProductRoute } from '@/app/api/products/route';
import { PATCH as updateProductRoute } from '@/app/api/products/[productId]/route';
import { PATCH as updateInventoryRoute } from '@/app/api/products/[productId]/inventory/route';

/**
 * Phase 14, Stage 4 - regression suite at the real API boundary for "supplier modifying another
 * supplier's product" (the exact scenario security.test.ts used to cover against the mock).
 * Uses two real minted sessions - one for the owning supplier's admin, one for an unrelated
 * supplier - against a dedicated scratch supplier/product this suite owns end-to-end.
 */

const OWNER_SUPPLIER_ID = `test-supplier-routes-${Date.now()}`;
const OWNER_COMPANY_ID = `${OWNER_SUPPLIER_ID}-company`;
const OWNER_USER_ID = 'user-adwoa-mensah'; // seeded SUPPLIER_ADMIN at supplier-company-abc
const OTHER_USER_ID = 'user-kofi-boateng'; // seeded SUPPLIER_ADMIN at supplier-company-prime (supplier-prime)

let ownerSessionToken: string;
let otherSupplierSessionToken: string;
let categoryId: string;
let warehouseId: string;

function requestFor(url: string, token: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: OWNER_COMPANY_ID, name: 'Routes Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true } });
  await db.supplierProfile.create({
    data: {
      id: OWNER_SUPPLIER_ID,
      companyId: OWNER_COMPANY_ID,
      name: 'Routes Test Supplier',
      slug: `routes-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  // Temporarily attach the seeded OWNER_USER_ID to this scratch supplier company so their
  // session resolves tenant.supplierId to OWNER_SUPPLIER_ID (mirrors how a real supplier admin
  // is actually scoped - via CompanyMembership, never asserted by the client).
  await db.companyMembership.create({
    data: { companyId: OWNER_COMPANY_ID, userId: OWNER_USER_ID, role: 'SUPPLIER_ADMIN', status: 'ACTIVE', joinedAt: new Date() },
  });

  const category = await db.category.create({ data: { name: 'Routes Test Category', slug: `routes-test-category-${Date.now()}` } });
  categoryId = category.id;
  const warehouse = await db.warehouse.create({ data: { supplierId: OWNER_SUPPLIER_ID, name: 'Routes Test Warehouse', city: 'Accra' } });
  warehouseId = warehouse.id;

  ownerSessionToken = (await createSession({ userId: OWNER_USER_ID, activeCompanyId: OWNER_COMPANY_ID })).token;
  // The other supplier's session uses their real, pre-existing seeded company (supplier-company-
  // prime / supplier-prime) - a genuinely different supplier, no scratch data needed for them.
  otherSupplierSessionToken = (await createSession({ userId: OTHER_USER_ID, activeCompanyId: 'supplier-company-prime' })).token;
});

afterAll(async () => {
  await db.product.deleteMany({ where: { supplierId: OWNER_SUPPLIER_ID } });
  await db.warehouse.deleteMany({ where: { supplierId: OWNER_SUPPLIER_ID } });
  await db.category.delete({ where: { id: categoryId } }).catch(() => undefined);
  await db.companyMembership.deleteMany({ where: { companyId: OWNER_COMPANY_ID } });
  await db.supplierProfile.delete({ where: { id: OWNER_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: OWNER_COMPANY_ID } }).catch(() => undefined);
});

describe("Supplier modifying another supplier's product (real API boundary)", () => {
  it('refuses creating a product attributed to a different supplier id than the caller', async () => {
    const request = requestFor('/api/products', otherSupplierSessionToken, {
      method: 'POST',
      body: JSON.stringify({
        supplierId: OWNER_SUPPLIER_ID, // impersonating a supplier the caller isn't
        name: 'Impersonated listing',
        brand: 'x',
        sku: 'x',
        categoryId,
        description: 'x',
        currency: 'GHS',
        basePrice: 100,
        moq: 1,
        warehouseId,
        stock: 1,
        lowStockThreshold: 1,
      }),
    });
    const response = await createProductRoute(request);
    expect(response.status).toBe(404);
  });

  it('creates a product as the owning supplier, then refuses another supplier updating it', async () => {
    const createRequest = requestFor('/api/products', ownerSessionToken, {
      method: 'POST',
      body: JSON.stringify({
        supplierId: OWNER_SUPPLIER_ID,
        name: 'Real listing',
        brand: 'x',
        sku: 'x',
        categoryId,
        description: 'x',
        currency: 'GHS',
        basePrice: 100,
        moq: 1,
        warehouseId,
        stock: 5,
        lowStockThreshold: 1,
      }),
    });
    const createResponse = await createProductRoute(createRequest);
    expect(createResponse.status).toBe(200);
    const product = await createResponse.json();

    const wrongUpdateRequest = requestFor(`/api/products/${product.id}`, otherSupplierSessionToken, {
      method: 'PATCH',
      body: JSON.stringify({ basePrice: 1 }),
    });
    const wrongUpdateResponse = await updateProductRoute(wrongUpdateRequest, { params: Promise.resolve({ productId: product.id }) });
    expect(wrongUpdateResponse.status).toBe(404);

    const wrongInventoryRequest = requestFor(`/api/products/${product.id}/inventory`, otherSupplierSessionToken, {
      method: 'PATCH',
      body: JSON.stringify({ warehouseId, stock: 0 }),
    });
    const wrongInventoryResponse = await updateInventoryRoute(wrongInventoryRequest, { params: Promise.resolve({ productId: product.id }) });
    expect(wrongInventoryResponse.status).toBe(404);

    const rightUpdateRequest = requestFor(`/api/products/${product.id}`, ownerSessionToken, {
      method: 'PATCH',
      body: JSON.stringify({ basePrice: 8500 }),
    });
    const rightUpdateResponse = await updateProductRoute(rightUpdateRequest, { params: Promise.resolve({ productId: product.id }) });
    expect(rightUpdateResponse.status).toBe(200);
    const updated = await rightUpdateResponse.json();
    expect(updated.basePrice).toBe(8500);
  });
});
