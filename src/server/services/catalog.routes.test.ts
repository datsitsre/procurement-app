// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listProductsRoute, POST as createProductRoute } from '@/app/api/products/route';
import { PATCH as updateProductRoute } from '@/app/api/products/[productId]/route';
import { PATCH as updateInventoryRoute } from '@/app/api/products/[productId]/inventory/route';
import { GET as listSuppliersRoute } from '@/app/api/suppliers/route';
import { GET as getSupplierBySlugRoute } from '@/app/api/suppliers/slug/[slug]/route';
import { GET as listSuppliersForModerationRoute } from '@/app/api/suppliers/moderation/route';
import { PATCH as verifySupplierRoute } from '@/app/api/suppliers/[supplierId]/verification/route';

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

const PLATFORM_ADMIN_USER_ID = 'user-grace-owusu'; // seeded PLATFORM_ADMIN at platform-hq

let ownerSessionToken: string;
let otherSupplierSessionToken: string;
let platformAdminSessionToken: string;
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
  platformAdminSessionToken = (await createSession({ userId: PLATFORM_ADMIN_USER_ID, activeCompanyId: 'platform-hq' })).token;
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

describe('Suppliers API (real API boundary)', () => {
  it('GET /api/suppliers is public and lists the verified scratch supplier', async () => {
    const response = await listSuppliersRoute(new NextRequest(`http://localhost/api/suppliers?search=${encodeURIComponent('Routes Test Supplier')}`));
    expect(response.status).toBe(200);
    const suppliers = await response.json();
    expect(suppliers.some((s: { id: string }) => s.id === OWNER_SUPPLIER_ID)).toBe(true);
  });

  it('GET /api/suppliers/slug/[slug] is public and 404s for a slug that does not exist', async () => {
    const found = await getSupplierBySlugRoute(new NextRequest('http://localhost/api/suppliers/slug/does-not-exist'), {
      params: Promise.resolve({ slug: 'does-not-exist' }),
    });
    expect(found.status).toBe(404);
  });

  it('GET /api/suppliers/moderation refuses a non-platform-admin and allows the platform admin', async () => {
    const refused = await listSuppliersForModerationRoute(requestFor('/api/suppliers/moderation', ownerSessionToken));
    expect(refused.status).toBe(403);

    const allowed = await listSuppliersForModerationRoute(requestFor('/api/suppliers/moderation', platformAdminSessionToken));
    expect(allowed.status).toBe(200);
    const suppliers = await allowed.json();
    expect(suppliers.some((s: { id: string }) => s.id === OWNER_SUPPLIER_ID)).toBe(true);
  });

  it('PATCH /api/suppliers/[supplierId]/verification refuses a non-platform-admin (even the supplier itself) and allows the platform admin', async () => {
    const refused = await verifySupplierRoute(
      requestFor(`/api/suppliers/${OWNER_SUPPLIER_ID}/verification`, ownerSessionToken, { method: 'PATCH', body: JSON.stringify({ decision: 'SUSPENDED' }) }),
      { params: Promise.resolve({ supplierId: OWNER_SUPPLIER_ID }) },
    );
    expect(refused.status).toBe(403);

    const allowed = await verifySupplierRoute(
      requestFor(`/api/suppliers/${OWNER_SUPPLIER_ID}/verification`, platformAdminSessionToken, {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'SUSPENDED' }),
      }),
      { params: Promise.resolve({ supplierId: OWNER_SUPPLIER_ID }) },
    );
    expect(allowed.status).toBe(200);
    const updated = await allowed.json();
    expect(updated.verification).toBe('SUSPENDED');

    // Restore, so this file's own earlier "public directory" assertions aren't order-dependent.
    await verifySupplierRoute(
      requestFor(`/api/suppliers/${OWNER_SUPPLIER_ID}/verification`, platformAdminSessionToken, {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'VERIFIED' }),
      }),
      { params: Promise.resolve({ supplierId: OWNER_SUPPLIER_ID }) },
    );
  });
});

describe('GET /api/products (pagination, Phase 17)', () => {
  const PAGINATION_PRODUCT_IDS = [`${OWNER_SUPPLIER_ID}-pub-1`, `${OWNER_SUPPLIER_ID}-pub-2`, `${OWNER_SUPPLIER_ID}-pub-3`];

  beforeAll(async () => {
    for (const id of PAGINATION_PRODUCT_IDS) {
      await db.product.create({
        data: {
          id,
          supplierId: OWNER_SUPPLIER_ID,
          categoryId,
          name: `Pagination Test ${id}`,
          slug: id,
          brand: 'x',
          sku: id,
          description: 'x',
          currency: 'GHS',
          basePrice: 100,
          moq: 1,
          moderationStatus: 'PUBLISHED',
        },
      });
    }
  });

  afterAll(async () => {
    await db.product.deleteMany({ where: { id: { in: PAGINATION_PRODUCT_IDS } } });
  });

  it('returns a real Page envelope with only published products for this supplier', async () => {
    const response = await listProductsRoute(new NextRequest(`http://localhost/api/products?supplierId=${OWNER_SUPPLIER_ID}&pageSize=2&page=1`));
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(2);
    expect(page.items.every((p: { supplierId: string }) => p.supplierId === OWNER_SUPPLIER_ID)).toBe(true);
  });

  it('pages advance without overlap across two consecutive pages', async () => {
    const page1 = await (
      await listProductsRoute(new NextRequest(`http://localhost/api/products?supplierId=${OWNER_SUPPLIER_ID}&pageSize=2&page=1`))
    ).json();
    const page2 = await (
      await listProductsRoute(new NextRequest(`http://localhost/api/products?supplierId=${OWNER_SUPPLIER_ID}&pageSize=2&page=2`))
    ).json();
    const page1Ids = page1.items.map((p: { id: string }) => p.id);
    const page2Ids = page2.items.map((p: { id: string }) => p.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });

  it('clamps an excessive pageSize to the documented maximum (500) instead of returning unbounded rows', async () => {
    const response = await listProductsRoute(new NextRequest('http://localhost/api/products?pageSize=999999'));
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.pageSize).toBeLessThanOrEqual(500);
  });

  it('falls back to page 1 for a manipulated/invalid page number rather than erroring', async () => {
    const response = await listProductsRoute(new NextRequest(`http://localhost/api/products?supplierId=${OWNER_SUPPLIER_ID}&page=-3`));
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.page).toBe(1);
  });
});
