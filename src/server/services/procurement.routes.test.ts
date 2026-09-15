// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as getRfqRoute } from '@/app/api/rfqs/[rfqId]/route';
import { GET as listQuotesRoute, POST as submitQuoteRoute } from '@/app/api/rfqs/[rfqId]/quotes/route';
import { POST as acceptQuoteRoute } from '@/app/api/rfqs/[rfqId]/quotes/[quoteId]/accept/route';
import { POST as sendNegotiationMessageRoute } from '@/app/api/rfqs/[rfqId]/quotes/[quoteId]/negotiations/route';
import { GET as getPurchaseRequestRoute } from '@/app/api/purchase-requests/[id]/route';
import { POST as decideStepRoute } from '@/app/api/purchase-requests/[id]/decide/route';

/**
 * Phase 14, Stage 5 - regression suite at the real API boundary for RFQ/quote tenant isolation:
 * an uninvited supplier, an unrelated buyer company, and an invited supplier's own quote view,
 * against a dedicated scratch buyer/supplier/RFQ this suite owns end-to-end.
 */

const BUYER_COMPANY_ID = `test-company-routes-${Date.now()}`;
const OWNER_SUPPLIER_ID = `test-supplier-routes-${Date.now()}`;
const OWNER_SUPPLIER_COMPANY_ID = `${OWNER_SUPPLIER_ID}-company`;
const CATEGORY_ID = `test-category-routes-${Date.now()}`;
const PRODUCT_ID = `test-product-routes-${Date.now()}`;
const RFQ_ID = `test-rfq-routes-${Date.now()}`;

const BUYER_USER_ID = 'user-john-doe'; // seeded OWNER at company-acme-gh
const OWNER_SUPPLIER_USER_ID = 'user-adwoa-mensah'; // seeded SUPPLIER_ADMIN, reattached below
const UNINVITED_SUPPLIER_USER_ID = 'user-kofi-boateng'; // seeded SUPPLIER_ADMIN at supplier-prime
const EMPLOYEE_USER_ID = 'user-michael-doe'; // reattached below with EMPLOYEE role at the scratch buyer company
// Same physical user as BUYER_USER_ID, but signed in with a different seeded company active
// (John Doe is also OWNER at company-acme-ng) - a genuinely different tenant for isolation
// purposes, without needing a fabricated user id.
const OTHER_BUYER_ACTIVE_COMPANY_ID = 'company-acme-ng';

const PURCHASE_REQUEST_ID = `test-pr-routes-${Date.now()}`;

let buyerSessionToken: string;
let ownerSupplierSessionToken: string;
let uninvitedSupplierSessionToken: string;
let otherBuyerSessionToken: string;
let employeeSessionToken: string;

function requestFor(url: string, token: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Routes Test Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: OWNER_SUPPLIER_COMPANY_ID, name: 'Routes Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: OWNER_SUPPLIER_ID,
      companyId: OWNER_SUPPLIER_COMPANY_ID,
      name: 'Routes Test Supplier',
      slug: `routes-test-supplier-procurement-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: CATEGORY_ID, name: 'Routes Test Category', slug: `routes-test-category-procurement-${Date.now()}` } });
  await db.product.create({
    data: {
      id: PRODUCT_ID,
      supplierId: OWNER_SUPPLIER_ID,
      categoryId: CATEGORY_ID,
      name: 'Routes Test Widget',
      slug: `routes-test-widget-procurement-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      moderationStatus: 'PUBLISHED',
    },
  });
  await db.rFQ.create({
    data: {
      id: RFQ_ID,
      reference: `RFQ-ROUTES-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      createdByUserId: BUYER_USER_ID,
      requiredDeliveryDate: new Date(),
      deliveryLocation: 'Accra',
      status: 'SENT',
      items: { create: [{ productId: PRODUCT_ID, productName: 'Routes Test Widget', quantity: 10 }] },
      suppliers: { create: [{ supplierId: OWNER_SUPPLIER_ID, status: 'INVITED' }] },
    },
  });

  await db.companyMembership.createMany({
    data: [
      { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: BUYER_COMPANY_ID, userId: EMPLOYEE_USER_ID, role: 'EMPLOYEE', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: OWNER_SUPPLIER_COMPANY_ID, userId: OWNER_SUPPLIER_USER_ID, role: 'SUPPLIER_ADMIN', status: 'ACTIVE', joinedAt: new Date() },
    ],
  });

  // No ApprovalRule rows exist for this scratch company, so the request falls back to a single
  // OWNER approval step - matching what createPurchaseRequest itself would resolve.
  await db.purchaseRequest.create({
    data: {
      id: PURCHASE_REQUEST_ID,
      reference: `PR-ROUTES-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      requesterUserId: BUYER_USER_ID,
      totalAmount: 2112,
      reason: 'Routes test purchase request',
      items: {
        create: [{ productId: PRODUCT_ID, productName: 'Routes Test Widget', supplierId: OWNER_SUPPLIER_ID, supplierName: 'Routes Test Supplier', quantity: 1, unitPrice: 100 }],
      },
      approvalSteps: { create: [{ stepOrder: 1, approverRole: 'OWNER' }] },
    },
  });

  buyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  ownerSupplierSessionToken = (await createSession({ userId: OWNER_SUPPLIER_USER_ID, activeCompanyId: OWNER_SUPPLIER_COMPANY_ID })).token;
  employeeSessionToken = (await createSession({ userId: EMPLOYEE_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  // Genuinely different, pre-existing seeded tenants - no scratch data needed for these two.
  uninvitedSupplierSessionToken = (await createSession({ userId: UNINVITED_SUPPLIER_USER_ID, activeCompanyId: 'supplier-company-prime' })).token;
  otherBuyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: OTHER_BUYER_ACTIVE_COMPANY_ID })).token;
});

afterAll(async () => {
  // submitQuote/decideStep (Phase 14, Stage 9) notify the RFQ creator/PR requester for real now
  // - both land on BUYER_USER_ID, referencing these two ids.
  await db.notification.deleteMany({ where: { entityId: { in: [RFQ_ID, PURCHASE_REQUEST_ID] } } });
  // acceptQuote/decideStep (Stage 7) build real PurchaseOrders inline - clean those up first.
  await db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { companyId: BUYER_COMPANY_ID } } });
  await db.purchaseOrder.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.quoteItem.deleteMany({ where: { quote: { rfqId: RFQ_ID } } });
  await db.quote.deleteMany({ where: { rfqId: RFQ_ID } });
  await db.rFQSupplier.deleteMany({ where: { rfqId: RFQ_ID } });
  await db.rFQItem.deleteMany({ where: { rfqId: RFQ_ID } });
  await db.rFQ.delete({ where: { id: RFQ_ID } }).catch(() => undefined);
  await db.approvalStep.deleteMany({ where: { requestId: PURCHASE_REQUEST_ID } });
  await db.purchaseRequestItem.deleteMany({ where: { requestId: PURCHASE_REQUEST_ID } });
  await db.purchaseRequest.delete({ where: { id: PURCHASE_REQUEST_ID } }).catch(() => undefined);
  await db.product.delete({ where: { id: PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: CATEGORY_ID } }).catch(() => undefined);
  await db.companyMembership.deleteMany({ where: { companyId: { in: [BUYER_COMPANY_ID, OWNER_SUPPLIER_COMPANY_ID] } } });
  await db.supplierProfile.delete({ where: { id: OWNER_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: OWNER_SUPPLIER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: BUYER_COMPANY_ID } }).catch(() => undefined);
});

describe('GET /api/rfqs/[rfqId] (dual-owner tenant isolation)', () => {
  it('rejects an unauthenticated request', async () => {
    const request = new NextRequest(`http://localhost/api/rfqs/${RFQ_ID}`);
    const response = await getRfqRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(401);
  });

  it("refuses an unrelated buyer company reading another company's RFQ", async () => {
    const request = requestFor(`/api/rfqs/${RFQ_ID}`, otherBuyerSessionToken);
    const response = await getRfqRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(404);
  });

  it("refuses a supplier who was never invited to this RFQ", async () => {
    const request = requestFor(`/api/rfqs/${RFQ_ID}`, uninvitedSupplierSessionToken);
    const response = await getRfqRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(404);
  });

  it('allows the owning buyer company', async () => {
    const request = requestFor(`/api/rfqs/${RFQ_ID}`, buyerSessionToken);
    const response = await getRfqRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(200);
  });

  it('allows the invited supplier', async () => {
    const request = requestFor(`/api/rfqs/${RFQ_ID}`, ownerSupplierSessionToken);
    const response = await getRfqRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(200);
  });
});

describe('POST /api/rfqs/[rfqId]/quotes (submit + accept)', () => {
  it("refuses a supplier submitting a quote attributed to a different supplier id than the caller", async () => {
    const request = requestFor(`/api/rfqs/${RFQ_ID}/quotes`, uninvitedSupplierSessionToken, {
      method: 'POST',
      body: JSON.stringify({
        supplierId: OWNER_SUPPLIER_ID, // impersonating a supplier the caller isn't
        items: [{ productId: PRODUCT_ID, quantity: 10, unitPrice: 95 }],
        deliveryDays: 3,
        warrantyMonths: 12,
      }),
    });
    const response = await submitQuoteRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(404);
  });

  it('submits a quote as the invited supplier, then only that supplier and the buyer can list it', async () => {
    const submitRequest = requestFor(`/api/rfqs/${RFQ_ID}/quotes`, ownerSupplierSessionToken, {
      method: 'POST',
      body: JSON.stringify({
        supplierId: OWNER_SUPPLIER_ID,
        items: [{ productId: PRODUCT_ID, quantity: 10, unitPrice: 95 }],
        deliveryDays: 3,
        warrantyMonths: 12,
      }),
    });
    const submitResponse = await submitQuoteRoute(submitRequest, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(submitResponse.status).toBe(200);
    const quote = await submitResponse.json();

    const buyerList = await listQuotesRoute(requestFor(`/api/rfqs/${RFQ_ID}/quotes`, buyerSessionToken), {
      params: Promise.resolve({ rfqId: RFQ_ID }),
    });
    expect(buyerList.status).toBe(200);
    expect((await buyerList.json()).some((q: { id: string }) => q.id === quote.id)).toBe(true);

    const uninvitedList = await listQuotesRoute(requestFor(`/api/rfqs/${RFQ_ID}/quotes`, uninvitedSupplierSessionToken), {
      params: Promise.resolve({ rfqId: RFQ_ID }),
    });
    expect(uninvitedList.status).toBe(404);

    // Only the buyer - not a different, unrelated buyer company - may accept the quote. A
    // generic 404, never a distinct "forbidden" (see requireCompanyAccess's own comment) - the
    // caller has the right permission in their own tenant, just not ownership of this RFQ.
    const wrongAccept = await acceptQuoteRoute(requestFor(`/api/rfqs/${RFQ_ID}/quotes/${quote.id}/accept`, otherBuyerSessionToken, { method: 'POST' }), {
      params: Promise.resolve({ rfqId: RFQ_ID, quoteId: quote.id }),
    });
    expect(wrongAccept.status).toBe(404);

    const accept = await acceptQuoteRoute(requestFor(`/api/rfqs/${RFQ_ID}/quotes/${quote.id}/accept`, buyerSessionToken, { method: 'POST' }), {
      params: Promise.resolve({ rfqId: RFQ_ID, quoteId: quote.id }),
    });
    expect(accept.status).toBe(200);
    const accepted = await accept.json();
    expect(accepted.rfq.status).toBe('ACCEPTED');
    expect(accepted.rfq.acceptedQuoteId).toBe(quote.id);

    // A second accept attempt on an already-accepted RFQ (a double-click, a retried request) is
    // a 409 conflict, not a second purchase order (section 6/25 - concurrency).
    const secondAccept = await acceptQuoteRoute(requestFor(`/api/rfqs/${RFQ_ID}/quotes/${quote.id}/accept`, buyerSessionToken, { method: 'POST' }), {
      params: Promise.resolve({ rfqId: RFQ_ID, quoteId: quote.id }),
    });
    expect(secondAccept.status).toBe(409);
  });
});

describe('POST /api/rfqs/[rfqId]/quotes/[quoteId]/negotiations (both sides can post, only these two)', () => {
  const NEGOTIATION_RFQ_ID = `test-rfq-negotiation-routes-${Date.now()}`;
  let negotiationQuoteId: string;

  beforeAll(async () => {
    await db.rFQ.create({
      data: {
        id: NEGOTIATION_RFQ_ID,
        reference: `RFQ-NEGOTIATION-ROUTES-${Date.now()}`,
        companyId: BUYER_COMPANY_ID,
        createdByUserId: BUYER_USER_ID,
        requiredDeliveryDate: new Date(),
        deliveryLocation: 'Accra',
        status: 'SENT',
        items: { create: [{ productId: PRODUCT_ID, productName: 'Routes Test Widget', quantity: 10 }] },
        suppliers: { create: [{ supplierId: OWNER_SUPPLIER_ID, status: 'INVITED' }] },
      },
    });
    const quote = await db.quote.create({
      data: {
        rfqId: NEGOTIATION_RFQ_ID,
        supplierId: OWNER_SUPPLIER_ID,
        totalPrice: 950,
        deliveryDays: 3,
        warrantyMonths: 12,
        items: { create: [{ productId: PRODUCT_ID, quantity: 10, unitPrice: 95 }] },
      },
    });
    negotiationQuoteId = quote.id;
  });

  afterAll(async () => {
    await db.notification.deleteMany({ where: { entityId: NEGOTIATION_RFQ_ID } });
    await db.negotiationMessage.deleteMany({ where: { rfqId: NEGOTIATION_RFQ_ID } });
    await db.quoteItem.deleteMany({ where: { quote: { rfqId: NEGOTIATION_RFQ_ID } } });
    await db.quote.deleteMany({ where: { rfqId: NEGOTIATION_RFQ_ID } });
    await db.rFQSupplier.deleteMany({ where: { rfqId: NEGOTIATION_RFQ_ID } });
    await db.rFQItem.deleteMany({ where: { rfqId: NEGOTIATION_RFQ_ID } });
    await db.rFQ.delete({ where: { id: NEGOTIATION_RFQ_ID } }).catch(() => undefined);
  });

  it('rejects a supplier who was never invited to this RFQ', async () => {
    const response = await sendNegotiationMessageRoute(
      requestFor(`/api/rfqs/${NEGOTIATION_RFQ_ID}/quotes/${negotiationQuoteId}/negotiations`, uninvitedSupplierSessionToken, {
        method: 'POST',
        body: JSON.stringify({ message: 'Can we get a better price?' }),
      }),
      { params: Promise.resolve({ rfqId: NEGOTIATION_RFQ_ID, quoteId: negotiationQuoteId }) },
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unrelated buyer company reading/posting into another company's RFQ", async () => {
    const response = await sendNegotiationMessageRoute(
      requestFor(`/api/rfqs/${NEGOTIATION_RFQ_ID}/quotes/${negotiationQuoteId}/negotiations`, otherBuyerSessionToken, {
        method: 'POST',
        body: JSON.stringify({ message: 'Trying to negotiate someone else\'s RFQ' }),
      }),
      { params: Promise.resolve({ rfqId: NEGOTIATION_RFQ_ID, quoteId: negotiationQuoteId }) },
    );
    expect(response.status).toBe(403);
  });

  it('allows the owning buyer to post, attributed as BUYER, and notifies the quote-owning supplier', async () => {
    const response = await sendNegotiationMessageRoute(
      requestFor(`/api/rfqs/${NEGOTIATION_RFQ_ID}/quotes/${negotiationQuoteId}/negotiations`, buyerSessionToken, {
        method: 'POST',
        body: JSON.stringify({ message: 'Can you do 90 per unit?', proposedPrice: 90 }),
      }),
      { params: Promise.resolve({ rfqId: NEGOTIATION_RFQ_ID, quoteId: negotiationQuoteId }) },
    );
    expect(response.status).toBe(200);
    const messages = await response.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].senderRole).toBe('BUYER');

    const notification = await db.notification.findFirst({ where: { userId: OWNER_SUPPLIER_USER_ID, type: 'NEGOTIATION_MESSAGE', entityId: NEGOTIATION_RFQ_ID } });
    expect(notification).not.toBeNull();
  });

  it('allows the quote-owning supplier to reply, attributed as SUPPLIER (a real user, not a canned message), and notifies the RFQ creator', async () => {
    const response = await sendNegotiationMessageRoute(
      requestFor(`/api/rfqs/${NEGOTIATION_RFQ_ID}/quotes/${negotiationQuoteId}/negotiations`, ownerSupplierSessionToken, {
        method: 'POST',
        body: JSON.stringify({ message: 'We can do 92.' }),
      }),
      { params: Promise.resolve({ rfqId: NEGOTIATION_RFQ_ID, quoteId: negotiationQuoteId }) },
    );
    expect(response.status).toBe(200);
    const messages = await response.json();
    expect(messages).toHaveLength(2);
    expect(messages[1].senderRole).toBe('SUPPLIER');
    expect(messages[1].senderName).toBe('Adwoa Mensah');

    const notification = await db.notification.findFirst({ where: { userId: BUYER_USER_ID, type: 'NEGOTIATION_MESSAGE', entityId: NEGOTIATION_RFQ_ID } });
    expect(notification).not.toBeNull();
  });
});

describe('GET /api/purchase-requests/[id] and POST .../decide (tenant + role isolation)', () => {
  it("refuses an unrelated company reading this purchase request", async () => {
    const response = await getPurchaseRequestRoute(requestFor(`/api/purchase-requests/${PURCHASE_REQUEST_ID}`, otherBuyerSessionToken), {
      params: Promise.resolve({ id: PURCHASE_REQUEST_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('allows the owning company to read it', async () => {
    const response = await getPurchaseRequestRoute(requestFor(`/api/purchase-requests/${PURCHASE_REQUEST_ID}`, buyerSessionToken), {
      params: Promise.resolve({ id: PURCHASE_REQUEST_ID }),
    });
    expect(response.status).toBe(200);
  });

  it('refuses an EMPLOYEE role (lacks PURCHASE_REQUEST_APPROVE) before any tenant check runs', async () => {
    const response = await decideStepRoute(
      requestFor(`/api/purchase-requests/${PURCHASE_REQUEST_ID}/decide`, employeeSessionToken, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED' }) }),
      { params: Promise.resolve({ id: PURCHASE_REQUEST_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it("refuses an owner at a different company approving/rejecting this request, even with the matching approver role", async () => {
    const response = await decideStepRoute(
      requestFor(`/api/purchase-requests/${PURCHASE_REQUEST_ID}/decide`, otherBuyerSessionToken, {
        method: 'POST',
        body: JSON.stringify({ decision: 'APPROVED' }),
      }),
      { params: Promise.resolve({ id: PURCHASE_REQUEST_ID }) },
    );
    expect(response.status).toBe(404);
  });

  it('lets the owning company decide it', async () => {
    const response = await decideStepRoute(
      requestFor(`/api/purchase-requests/${PURCHASE_REQUEST_ID}/decide`, buyerSessionToken, {
        method: 'POST',
        body: JSON.stringify({ decision: 'APPROVED' }),
      }),
      { params: Promise.resolve({ id: PURCHASE_REQUEST_ID }) },
    );
    expect(response.status).toBe(200);
    const decided = await response.json();
    expect(decided.status).toBe('CONVERTED_TO_PO');
  });
});
