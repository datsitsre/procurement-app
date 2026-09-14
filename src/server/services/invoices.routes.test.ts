// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as getInvoiceRoute } from '@/app/api/invoices/[id]/route';
import { POST as payInvoiceRoute } from '@/app/api/invoices/[id]/pay/route';

/**
 * Phase 14, Stage 8 - regression suite at the real API boundary for invoice tenant isolation
 * (the exact scenarios security.test.ts used to cover against the mock). Uses real minted
 * sessions against a dedicated scratch buyer/supplier/invoice this suite owns end-to-end.
 */

const BUYER_COMPANY_ID = `test-company-invoices-routes-${Date.now()}`;
const SUPPLIER_ID = `test-supplier-invoices-routes-${Date.now()}`;
const SUPPLIER_COMPANY_ID = `${SUPPLIER_ID}-company`;
const INVOICE_ID = `test-invoice-routes-${Date.now()}`;

const BUYER_USER_ID = 'user-john-doe'; // seeded OWNER at company-acme-gh
const OTHER_BUYER_ACTIVE_COMPANY_ID = 'company-acme-ng'; // John Doe is also OWNER here

let buyerSessionToken: string;
let otherBuyerSessionToken: string;

function requestFor(url: string, token: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Invoices Routes Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: SUPPLIER_COMPANY_ID, name: 'Invoices Routes Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: SUPPLIER_ID,
      companyId: SUPPLIER_COMPANY_ID,
      name: 'Invoices Routes Supplier',
      slug: `invoices-routes-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.invoice.create({
    data: {
      id: INVOICE_ID,
      reference: `INV-ROUTES-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      supplierId: SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      total: 1125,
      status: 'PENDING',
      dueDate: new Date(),
      items: { create: [{ description: 'Widget x1', quantity: 1, unitPrice: 1000 }] },
    },
  });

  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  buyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  otherBuyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: OTHER_BUYER_ACTIVE_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.paymentTransaction.deleteMany({ where: { payment: { companyId: BUYER_COMPANY_ID } } });
  await db.payment.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.invoiceItem.deleteMany({ where: { invoiceId: INVOICE_ID } });
  await db.invoice.delete({ where: { id: INVOICE_ID } }).catch(() => undefined);
  await db.companyMembership.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.supplierProfile.delete({ where: { id: SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: SUPPLIER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: BUYER_COMPANY_ID } }).catch(() => undefined);
});

describe('GET /api/invoices/[id] and POST .../pay (tenant isolation)', () => {
  it("refuses reading another company's invoice", async () => {
    const response = await getInvoiceRoute(requestFor(`/api/invoices/${INVOICE_ID}`, otherBuyerSessionToken), { params: Promise.resolve({ id: INVOICE_ID }) });
    expect(response.status).toBe(404);
  });

  it('allows the billed company to read it', async () => {
    const response = await getInvoiceRoute(requestFor(`/api/invoices/${INVOICE_ID}`, buyerSessionToken), { params: Promise.resolve({ id: INVOICE_ID }) });
    expect(response.status).toBe(200);
  });

  it("refuses paying another company's invoice even with a valid PAYMENTS_CREATE role", async () => {
    const response = await payInvoiceRoute(
      requestFor(`/api/invoices/${INVOICE_ID}/pay`, otherBuyerSessionToken, { method: 'POST', body: JSON.stringify({ method: 'WALLET', details: {} }) }),
      { params: Promise.resolve({ id: INVOICE_ID }) },
    );
    expect(response.status).toBe(404);
  });

  it('lets the billed company pay it', async () => {
    const response = await payInvoiceRoute(
      requestFor(`/api/invoices/${INVOICE_ID}/pay`, buyerSessionToken, { method: 'POST', body: JSON.stringify({ method: 'WALLET', details: {} }) }),
      { params: Promise.resolve({ id: INVOICE_ID }) },
    );
    expect(response.status).toBe(200);
    const paid = await response.json();
    expect(paid.status).toBe('PAID');
  });
});
