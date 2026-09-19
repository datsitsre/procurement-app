// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as getOrderRoute } from '@/app/api/orders/[id]/route';
import { POST as processingRoute } from '@/app/api/orders/[id]/processing/route';
import { GET as getPurchaseOrderRoute } from '@/app/api/purchase-orders/[id]/route';
import { POST as checkoutRoute } from '@/app/api/purchase-orders/[id]/checkout/route';
import { POST as createDisputeRoute } from '@/app/api/disputes/route';
import { GET as listCompanyOrdersRoute } from '@/app/api/companies/[companyId]/orders/route';
import { GET as listSupplierOrdersRoute } from '@/app/api/suppliers/[supplierId]/orders/route';

/**
 * Phase 14, Stage 7 - regression suite at the real API boundary for order/purchase-order tenant
 * isolation (the exact scenarios security.test.ts used to cover against the mock) plus the
 * checkout flow end to end. Uses real minted sessions against a dedicated scratch buyer/supplier/
 * purchase-order this suite owns end-to-end.
 */

const BUYER_COMPANY_ID = `test-company-orders-routes-${Date.now()}`;
const SUPPLIER_ID = `test-supplier-orders-routes-${Date.now()}`;
const SUPPLIER_COMPANY_ID = `${SUPPLIER_ID}-company`;
const CATEGORY_ID = `test-category-orders-routes-${Date.now()}`;
const PRODUCT_ID = `test-product-orders-routes-${Date.now()}`;
const PURCHASE_ORDER_ID = `test-po-routes-${Date.now()}`;
const ORDER_ID = `test-order-routes-${Date.now()}`;

const BUYER_USER_ID = 'user-john-doe'; // seeded OWNER at company-acme-gh
const SUPPLIER_USER_ID = 'user-adwoa-mensah'; // reattached below
const UNINVOLVED_SUPPLIER_USER_ID = 'user-kofi-boateng'; // seeded SUPPLIER_ADMIN at supplier-prime
const OTHER_BUYER_ACTIVE_COMPANY_ID = 'company-acme-ng'; // John Doe is also OWNER here

let buyerSessionToken: string;
let supplierSessionToken: string;
let uninvolvedSupplierSessionToken: string;
let otherBuyerSessionToken: string;

function requestFor(url: string, token: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Orders Routes Buyer Co', country: 'GH', currency: 'GHS', creditAvailable: 100000 } });
  await db.company.create({
    data: { id: SUPPLIER_COMPANY_ID, name: 'Orders Routes Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: SUPPLIER_ID,
      companyId: SUPPLIER_COMPANY_ID,
      name: 'Orders Routes Supplier',
      slug: `orders-routes-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: CATEGORY_ID, name: 'Orders Routes Category', slug: `orders-routes-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: PRODUCT_ID,
      supplierId: SUPPLIER_ID,
      categoryId: CATEGORY_ID,
      name: 'Orders Routes Widget',
      slug: `orders-routes-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 1000,
      moq: 1,
      moderationStatus: 'PUBLISHED',
    },
  });
  await db.purchaseOrder.create({
    data: {
      id: PURCHASE_ORDER_ID,
      reference: `PO-ROUTES-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      supplierId: SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      deliveryFee: 2000,
      total: 3125,
      paymentTerms: 'Net 30',
      deliveryLocation: 'Accra',
      authorizedByName: 'Test Buyer',
      items: { create: [{ productId: PRODUCT_ID, productName: 'Orders Routes Widget', quantity: 1, unitPrice: 1000 }] },
    },
  });
  await db.order.create({
    data: {
      id: ORDER_ID,
      reference: `ORD-ROUTES-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      supplierId: SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      deliveryFee: 2000,
      total: 3125,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      deliveryLocation: 'Accra',
      items: { create: [{ productId: PRODUCT_ID, productName: 'Orders Routes Widget', quantity: 1, unitPrice: 1000 }] },
    },
  });

  await db.companyMembership.createMany({
    data: [
      { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: SUPPLIER_COMPANY_ID, userId: SUPPLIER_USER_ID, role: 'SUPPLIER_ADMIN', status: 'ACTIVE', joinedAt: new Date() },
    ],
  });

  buyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  supplierSessionToken = (await createSession({ userId: SUPPLIER_USER_ID, activeCompanyId: SUPPLIER_COMPANY_ID })).token;
  uninvolvedSupplierSessionToken = (await createSession({ userId: UNINVOLVED_SUPPLIER_USER_ID, activeCompanyId: 'supplier-company-prime' })).token;
  otherBuyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: OTHER_BUYER_ACTIVE_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.dispute.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.delivery.deleteMany({ where: { orderId: ORDER_ID } });
  await db.shipment.deleteMany({ where: { orderId: ORDER_ID } });
  await db.orderTimelineEvent.deleteMany({ where: { orderId: ORDER_ID } });
  await db.orderItem.deleteMany({ where: { orderId: ORDER_ID } });
  await db.order.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { companyId: BUYER_COMPANY_ID } } });
  await db.purchaseOrder.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.product.delete({ where: { id: PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: CATEGORY_ID } }).catch(() => undefined);
  await db.companyMembership.deleteMany({ where: { companyId: { in: [BUYER_COMPANY_ID, SUPPLIER_COMPANY_ID] } } });
  await db.supplierProfile.delete({ where: { id: SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: SUPPLIER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: BUYER_COMPANY_ID } }).catch(() => undefined);
});

describe('GET /api/orders/[id] (buyer vs. supplier vs. an unrelated tenant)', () => {
  it("refuses a buyer from a different company reading someone else's order", async () => {
    const response = await getOrderRoute(requestFor(`/api/orders/${ORDER_ID}`, otherBuyerSessionToken), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(response.status).toBe(404);
  });

  it("refuses a supplier who isn't fulfilling this order", async () => {
    const response = await getOrderRoute(requestFor(`/api/orders/${ORDER_ID}`, uninvolvedSupplierSessionToken), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(response.status).toBe(404);
  });

  it('allows the owning buyer company and the fulfilling supplier', async () => {
    const buyerResponse = await getOrderRoute(requestFor(`/api/orders/${ORDER_ID}`, buyerSessionToken), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(buyerResponse.status).toBe(200);
    const supplierResponse = await getOrderRoute(requestFor(`/api/orders/${ORDER_ID}`, supplierSessionToken), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(supplierResponse.status).toBe(200);
  });
});

describe('POST /api/orders/[id]/processing (a supplier fulfilling an order that is not theirs)', () => {
  it('refuses a supplier who does not own the order', async () => {
    const response = await processingRoute(requestFor(`/api/orders/${ORDER_ID}/processing`, uninvolvedSupplierSessionToken, { method: 'POST' }), {
      params: Promise.resolve({ id: ORDER_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('allows the fulfilling supplier', async () => {
    const response = await processingRoute(requestFor(`/api/orders/${ORDER_ID}/processing`, supplierSessionToken, { method: 'POST' }), {
      params: Promise.resolve({ id: ORDER_ID }),
    });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.status).toBe('PROCESSING');
  });
});

describe('GET /api/purchase-orders/[id] and POST .../checkout', () => {
  it("refuses an unrelated company reading this purchase order", async () => {
    const response = await getPurchaseOrderRoute(requestFor(`/api/purchase-orders/${PURCHASE_ORDER_ID}`, otherBuyerSessionToken), {
      params: Promise.resolve({ id: PURCHASE_ORDER_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('allows the buying company and the fulfilling supplier', async () => {
    const buyerResponse = await getPurchaseOrderRoute(requestFor(`/api/purchase-orders/${PURCHASE_ORDER_ID}`, buyerSessionToken), {
      params: Promise.resolve({ id: PURCHASE_ORDER_ID }),
    });
    expect(buyerResponse.status).toBe(200);
    const supplierResponse = await getPurchaseOrderRoute(requestFor(`/api/purchase-orders/${PURCHASE_ORDER_ID}`, supplierSessionToken), {
      params: Promise.resolve({ id: PURCHASE_ORDER_ID }),
    });
    expect(supplierResponse.status).toBe(200);
  });

  it('refuses an unrelated company checking it out, then lets the owning company check it out', async () => {
    const wrongCheckout = await checkoutRoute(
      requestFor(`/api/purchase-orders/${PURCHASE_ORDER_ID}/checkout`, otherBuyerSessionToken, { method: 'POST', body: JSON.stringify({ method: 'CARD' }) }),
      { params: Promise.resolve({ id: PURCHASE_ORDER_ID }) },
    );
    expect(wrongCheckout.status).toBe(404);

    const checkout = await checkoutRoute(
      requestFor(`/api/purchase-orders/${PURCHASE_ORDER_ID}/checkout`, buyerSessionToken, { method: 'POST', body: JSON.stringify({ method: 'CREDIT_TERMS' }) }),
      { params: Promise.resolve({ id: PURCHASE_ORDER_ID }) },
    );
    expect(checkout.status).toBe(200);
    const order = await checkout.json();
    expect(order.paymentStatus).toBe('PENDING');
    expect(order.purchaseOrderId).toBe(PURCHASE_ORDER_ID);

    // Cleanup for this scratch order (separate from ORDER_ID, created by checkout itself) and
    // the real Payment/Invoice it produced (Phase 14, Stage 8).
    await db.paymentTransaction.deleteMany({ where: { payment: { orderId: order.id } } });
    await db.payment.deleteMany({ where: { orderId: order.id } });
    await db.invoiceItem.deleteMany({ where: { invoice: { orderId: order.id } } });
    await db.invoice.deleteMany({ where: { orderId: order.id } });
    await db.orderItem.deleteMany({ where: { orderId: order.id } });
    await db.orderTimelineEvent.deleteMany({ where: { orderId: order.id } });
    await db.shipment.deleteMany({ where: { orderId: order.id } });
    await db.order.delete({ where: { id: order.id } }).catch(() => undefined);
  });
});

describe('GET /api/companies/[companyId]/orders and /api/suppliers/[supplierId]/orders (pagination security, Phase 16)', () => {
  it("refuses a different company from listing this company's orders, regardless of page/pageSize query params", async () => {
    const response = await listCompanyOrdersRoute(
      requestFor(`/api/companies/${BUYER_COMPANY_ID}/orders?page=1&pageSize=25`, otherBuyerSessionToken),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(404);
  });

  it("refuses an unrelated supplier from listing this supplier's orders", async () => {
    const response = await listSupplierOrdersRoute(
      requestFor(`/api/suppliers/${SUPPLIER_ID}/orders`, uninvolvedSupplierSessionToken),
      { params: Promise.resolve({ supplierId: SUPPLIER_ID }) },
    );
    expect(response.status).toBe(404);
  });

  it('returns a real Page envelope, scoped to the owning company, for the owning caller', async () => {
    const response = await listCompanyOrdersRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/orders`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items.every((o: { companyId: string }) => o.companyId === BUYER_COMPANY_ID)).toBe(true);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
  });

  it('clamps an excessive pageSize to the configured maximum instead of returning unbounded rows', async () => {
    const response = await listCompanyOrdersRoute(
      requestFor(`/api/companies/${BUYER_COMPANY_ID}/orders?pageSize=999999`, buyerSessionToken),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.pageSize).toBeLessThanOrEqual(100);
  });

  it('falls back to page 1 for a manipulated/invalid page number rather than erroring or leaking another range', async () => {
    const response = await listCompanyOrdersRoute(
      requestFor(`/api/companies/${BUYER_COMPANY_ID}/orders?page=-5`, buyerSessionToken),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.page).toBe(1);
  });
});

describe("POST /api/disputes (fabricated dispute against an order that isn't the caller's)", () => {
  it("refuses filing a dispute against an order belonging to another company", async () => {
    const response = await createDisputeRoute(
      requestFor('/api/disputes', otherBuyerSessionToken, {
        method: 'POST',
        body: JSON.stringify({ orderId: ORDER_ID, reason: 'not mine', description: 'attempting to dispute an order I do not own' }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('derives companyId/supplierId/orderReference from the real order, never from client input', async () => {
    const response = await createDisputeRoute(
      requestFor('/api/disputes', buyerSessionToken, {
        method: 'POST',
        body: JSON.stringify({ orderId: ORDER_ID, reason: 'genuine issue', description: 'item arrived late' }),
      }),
    );
    expect(response.status).toBe(200);
    const dispute = await response.json();
    expect(dispute.companyId).toBe(BUYER_COMPANY_ID);
    expect(dispute.supplierId).toBe(SUPPLIER_ID);
  });
});
