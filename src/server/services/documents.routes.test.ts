// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { POST as uploadRfqDocumentRoute } from '@/app/api/rfqs/[rfqId]/documents/route';
import { POST as uploadPurchaseRequestDocumentRoute } from '@/app/api/purchase-requests/[id]/documents/route';
import { GET as downloadDocumentRoute, DELETE as deleteDocumentRoute } from '@/app/api/documents/[documentId]/route';

/**
 * Phase 20, Objective 2 - real API-boundary tests for the file-storage feature (previously
 * schema-only per PHASE19_FINAL_REPORT.md): upload, download, delete, tenant isolation, oversized
 * file, invalid MIME type, malicious/path-traversal filename, and a missing document. Uses the
 * real local-disk storage backend (server/services/storage) against real Postgres - no mocking of
 * the storage layer, since local disk is the one backend this repo actually implements (see
 * localDiskStorage.ts's own comment on why a real object-storage credential isn't available).
 */

const BUYER_COMPANY_ID = `test-company-docs-${Date.now()}`;
const SUPPLIER_ID = `test-supplier-docs-${Date.now()}`;
const SUPPLIER_COMPANY_ID = `${SUPPLIER_ID}-company`;
const CATEGORY_ID = `test-category-docs-${Date.now()}`;
const PRODUCT_ID = `test-product-docs-${Date.now()}`;
const RFQ_ID = `test-rfq-docs-${Date.now()}`;
const PURCHASE_REQUEST_ID = `test-pr-docs-${Date.now()}`;

const BUYER_USER_ID = 'user-john-doe'; // seeded OWNER at company-acme-gh
const SUPPLIER_USER_ID = 'user-adwoa-mensah'; // seeded SUPPLIER_ADMIN, reattached below
const UNINVITED_SUPPLIER_USER_ID = 'user-kofi-boateng'; // seeded SUPPLIER_ADMIN at supplier-prime, genuinely uninvolved

let buyerToken: string;
let supplierToken: string;
let uninvitedSupplierToken: string;
let otherBuyerToken: string; // real buyer, but genuinely unrelated to this fixture's RFQ/PR

const createdDocumentIds: string[] = [];

function uploadRequest(url: string, token: string, file: { name: string; type: string; content: string }) {
  const formData = new FormData();
  formData.set('file', new File([file.content], file.name, { type: file.type }));
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: formData,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost' }),
  });
}

function getRequest(url: string, token: string | null) {
  return new NextRequest(`http://localhost${url}`, {
    headers: token ? new Headers({ cookie: `session_token=${token}` }) : new Headers(),
  });
}

function deleteRequest(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'DELETE',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost' }),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Docs Test Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({ data: { id: SUPPLIER_COMPANY_ID, name: 'Docs Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true } });
  await db.supplierProfile.create({
    data: {
      id: SUPPLIER_ID,
      companyId: SUPPLIER_COMPANY_ID,
      name: 'Docs Test Supplier',
      slug: `docs-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: CATEGORY_ID, name: 'Docs Test Category', slug: `docs-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: PRODUCT_ID,
      supplierId: SUPPLIER_ID,
      categoryId: CATEGORY_ID,
      name: 'Docs Test Widget',
      slug: `docs-test-widget-${Date.now()}`,
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
      reference: `RFQ-DOCS-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      createdByUserId: BUYER_USER_ID,
      requiredDeliveryDate: new Date(),
      deliveryLocation: 'Accra',
      status: 'SENT',
      items: { create: [{ productId: PRODUCT_ID, productName: 'Docs Test Widget', quantity: 10 }] },
      suppliers: { create: [{ supplierId: SUPPLIER_ID, status: 'INVITED' }] },
    },
  });
  await db.companyMembership.createMany({
    data: [
      { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: SUPPLIER_COMPANY_ID, userId: SUPPLIER_USER_ID, role: 'SUPPLIER_ADMIN', status: 'ACTIVE', joinedAt: new Date() },
    ],
  });
  await db.purchaseRequest.create({
    data: {
      id: PURCHASE_REQUEST_ID,
      reference: `PR-DOCS-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      requesterUserId: BUYER_USER_ID,
      totalAmount: 100,
      reason: 'Docs test purchase request',
      items: { create: [{ productId: PRODUCT_ID, productName: 'Docs Test Widget', supplierId: SUPPLIER_ID, supplierName: 'Docs Test Supplier', quantity: 1, unitPrice: 100 }] },
      approvalSteps: { create: [{ stepOrder: 1, approverRole: 'OWNER' }] },
    },
  });

  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  supplierToken = (await createSession({ userId: SUPPLIER_USER_ID, activeCompanyId: SUPPLIER_COMPANY_ID })).token;
  uninvitedSupplierToken = (await createSession({ userId: UNINVITED_SUPPLIER_USER_ID, activeCompanyId: 'supplier-company-prime' })).token;
  // Same real buyer user, but signed in with a different, genuinely unrelated seeded company active.
  otherBuyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: 'company-acme-ng' })).token;
});

afterAll(async () => {
  await db.document.deleteMany({ where: { id: { in: createdDocumentIds } } });
  // PurchaseRequestItem/ApprovalStep both cascade on PurchaseRequest delete - no separate cleanup needed.
  await db.purchaseRequest.delete({ where: { id: PURCHASE_REQUEST_ID } }).catch(() => undefined);
  await db.rFQItem.deleteMany({ where: { rfqId: RFQ_ID } });
  await db.rFQSupplier.deleteMany({ where: { rfqId: RFQ_ID } });
  await db.rFQ.delete({ where: { id: RFQ_ID } }).catch(() => undefined);
  await db.product.delete({ where: { id: PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: CATEGORY_ID } }).catch(() => undefined);
  await db.companyMembership.deleteMany({ where: { companyId: { in: [BUYER_COMPANY_ID, SUPPLIER_COMPANY_ID] } } });
  await db.supplierProfile.delete({ where: { id: SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: SUPPLIER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: BUYER_COMPANY_ID } }).catch(() => undefined);
});

describe('POST /api/rfqs/[rfqId]/documents (upload)', () => {
  it('refuses an unauthenticated upload', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, 'not-a-real-token', { name: 'spec.pdf', type: 'application/pdf', content: 'x' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(401);
  });

  it('lets the owning buyer upload a valid PDF', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, buyerToken, { name: 'spec sheet.pdf', type: 'application/pdf', content: 'a real pdf-ish body' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.fileName).toBe('spec sheet.pdf');
    expect(body.mimeType).toBe('application/pdf');
    createdDocumentIds.push(body.id);
  });

  it('lets an invited supplier upload to the same RFQ', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, supplierToken, { name: 'quote-attachment.pdf', type: 'application/pdf', content: 'supplier-side attachment' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    createdDocumentIds.push(body.id);
  });

  it('denies an uninvited supplier - 404, not 403 (IDOR-safe)', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, uninvitedSupplierToken, { name: 'x.pdf', type: 'application/pdf', content: 'x' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(404);
  });

  it('denies an unrelated buyer company - 404', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, otherBuyerToken, { name: 'x.pdf', type: 'application/pdf', content: 'x' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(404);
  });

  it('rejects an oversized file (over the 10MB limit)', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, buyerToken, { name: 'huge.pdf', type: 'application/pdf', content: 'x'.repeat(11 * 1024 * 1024) });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(422);
  });

  it('rejects a disallowed MIME type (an executable)', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, buyerToken, { name: 'setup.exe', type: 'application/x-msdownload', content: 'MZ' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(422);
  });

  it('sanitizes a path-traversal filename instead of using it as a storage path', async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, buyerToken, { name: '../../etc/passwd', type: 'application/pdf', content: 'x' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.fileName).not.toContain('..');
    expect(body.fileName).not.toContain('/');
    createdDocumentIds.push(body.id);
  });

  it('returns 404 for a nonexistent RFQ', async () => {
    const request = uploadRequest('/api/rfqs/does-not-exist/documents', buyerToken, { name: 'x.pdf', type: 'application/pdf', content: 'x' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: 'does-not-exist' }) });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/purchase-requests/[id]/documents (upload)', () => {
  it('lets the owning buyer upload', async () => {
    const request = uploadRequest(`/api/purchase-requests/${PURCHASE_REQUEST_ID}/documents`, buyerToken, { name: 'approval-memo.pdf', type: 'application/pdf', content: 'memo' });
    const response = await uploadPurchaseRequestDocumentRoute(request, { params: Promise.resolve({ id: PURCHASE_REQUEST_ID }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    createdDocumentIds.push(body.id);
  });

  it('denies a supplier who has no relationship to a purchase request - 404', async () => {
    const request = uploadRequest(`/api/purchase-requests/${PURCHASE_REQUEST_ID}/documents`, supplierToken, { name: 'x.pdf', type: 'application/pdf', content: 'x' });
    const response = await uploadPurchaseRequestDocumentRoute(request, { params: Promise.resolve({ id: PURCHASE_REQUEST_ID }) });
    expect(response.status).toBe(404);
  });
});

describe('GET /api/documents/[documentId] (download)', () => {
  let documentId: string;

  beforeAll(async () => {
    const request = uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, buyerToken, { name: 'download-me.pdf', type: 'application/pdf', content: 'the real file bytes' });
    const response = await uploadRfqDocumentRoute(request, { params: Promise.resolve({ rfqId: RFQ_ID }) });
    const body = await response.json();
    documentId = body.id;
    createdDocumentIds.push(documentId);
  });

  it('denies an unauthenticated download', async () => {
    const response = await downloadDocumentRoute(getRequest(`/api/documents/${documentId}`, null), { params: Promise.resolve({ documentId }) });
    expect(response.status).toBe(401);
  });

  it('lets the owning buyer download the real bytes', async () => {
    const response = await downloadDocumentRoute(getRequest(`/api/documents/${documentId}`, buyerToken), { params: Promise.resolve({ documentId }) });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('the real file bytes');
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });

  it('lets the invited supplier download the same document', async () => {
    const response = await downloadDocumentRoute(getRequest(`/api/documents/${documentId}`, supplierToken), { params: Promise.resolve({ documentId }) });
    expect(response.status).toBe(200);
  });

  it('denies an unrelated buyer company - 404', async () => {
    const response = await downloadDocumentRoute(getRequest(`/api/documents/${documentId}`, otherBuyerToken), { params: Promise.resolve({ documentId }) });
    expect(response.status).toBe(404);
  });

  it('denies an uninvited supplier - 404', async () => {
    const response = await downloadDocumentRoute(getRequest(`/api/documents/${documentId}`, uninvitedSupplierToken), { params: Promise.resolve({ documentId }) });
    expect(response.status).toBe(404);
  });

  it('returns 404 for a nonexistent document', async () => {
    const response = await downloadDocumentRoute(getRequest('/api/documents/does-not-exist', buyerToken), { params: Promise.resolve({ documentId: 'does-not-exist' }) });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/documents/[documentId]', () => {
  it('denies an unrelated buyer, then lets the owner delete, then 404s on a second delete', async () => {
    const uploadResponse = await uploadRfqDocumentRoute(
      uploadRequest(`/api/rfqs/${RFQ_ID}/documents`, buyerToken, { name: 'to-delete.pdf', type: 'application/pdf', content: 'bye' }),
      { params: Promise.resolve({ rfqId: RFQ_ID }) },
    );
    const { id: documentId } = await uploadResponse.json();

    const deniedResponse = await deleteDocumentRoute(deleteRequest(`/api/documents/${documentId}`, otherBuyerToken), { params: Promise.resolve({ documentId }) });
    expect(deniedResponse.status).toBe(404);

    const deleteResponse = await deleteDocumentRoute(deleteRequest(`/api/documents/${documentId}`, buyerToken), { params: Promise.resolve({ documentId }) });
    expect(deleteResponse.status).toBe(200);

    const secondDelete = await deleteDocumentRoute(deleteRequest(`/api/documents/${documentId}`, buyerToken), { params: Promise.resolve({ documentId }) });
    expect(secondDelete.status).toBe(404);

    const downloadAfterDelete = await downloadDocumentRoute(getRequest(`/api/documents/${documentId}`, buyerToken), { params: Promise.resolve({ documentId }) });
    expect(downloadAfterDelete.status).toBe(404);
  });
});
