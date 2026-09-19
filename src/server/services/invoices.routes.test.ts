// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as getInvoiceRoute } from '@/app/api/invoices/[id]/route';
import { POST as payInvoiceRoute } from '@/app/api/invoices/[id]/pay/route';
import { GET as listCompanyInvoicesRoute } from '@/app/api/companies/[companyId]/invoices/route';
import { GET as listSupplierInvoicesRoute } from '@/app/api/suppliers/[supplierId]/invoices/route';
import { GET as invoiceAgingSummaryRoute } from '@/app/api/companies/[companyId]/invoices/aging-summary/route';

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

  // 29 more invoices (30 total with INVOICE_ID) - enough to exercise a second, non-final page at
  // the default pageSize of 25 (Phase 19, section 1/6).
  const paginationRows = Array.from({ length: 29 }, (_, i) => ({
    id: `${INVOICE_ID}-page-${i}`,
    reference: `INV-ROUTES-PAGE-${Date.now()}-${i}`,
    companyId: BUYER_COMPANY_ID,
    supplierId: SUPPLIER_ID,
    subtotal: 100,
    tax: 12,
    total: 112,
    status: 'PENDING' as const,
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    issuedAt: new Date(Date.now() - i * 60_000), // strictly decreasing, deterministic order
  }));
  await db.invoice.createMany({ data: paginationRows });

  buyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  otherBuyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: OTHER_BUYER_ACTIVE_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.paymentTransaction.deleteMany({ where: { payment: { companyId: BUYER_COMPANY_ID } } });
  await db.payment.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.invoiceItem.deleteMany({ where: { invoice: { companyId: BUYER_COMPANY_ID } } });
  await db.invoice.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
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

describe('GET /api/companies/[companyId]/invoices (pagination, Phase 19)', () => {
  it('returns a real Page envelope, scoped to the owning company, for the owning caller', async () => {
    const response = await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.total).toBe(30);
    expect(page.items).toHaveLength(25);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(25);
    expect(page.items.every((inv: { companyId: string }) => inv.companyId === BUYER_COMPANY_ID)).toBe(true);
  });

  it('page 2 returns the remaining 5 rows, with no overlap with page 1', async () => {
    const page1 = await (
      await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?page=1`, buyerSessionToken), {
        params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
      })
    ).json();
    const page2 = await (
      await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?page=2`, buyerSessionToken), {
        params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
      })
    ).json();
    expect(page2.items).toHaveLength(5);
    const page1Ids = page1.items.map((i: { id: string }) => i.id);
    const page2Ids = page2.items.map((i: { id: string }) => i.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    // Together, both pages account for every seeded row exactly once.
    expect(new Set([...page1Ids, ...page2Ids]).size).toBe(30);
  });

  it('a page past the last one returns an empty item list, not an error', async () => {
    const response = await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?page=99`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(30);
  });

  it('respects a custom pageSize', async () => {
    const response = await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?pageSize=10`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    const page = await response.json();
    expect(page.items).toHaveLength(10);
    expect(page.pageSize).toBe(10);
  });

  it('clamps an excessive pageSize to the configured maximum instead of returning unbounded rows', async () => {
    const response = await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?pageSize=999999`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    const page = await response.json();
    expect(page.pageSize).toBeLessThanOrEqual(100);
  });

  it('falls back to page 1 for a manipulated/invalid page number rather than erroring', async () => {
    const response = await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?page=-5`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.page).toBe(1);
  });

  it('falls back to a safe default for a non-numeric pageSize rather than erroring', async () => {
    const response = await listCompanyInvoicesRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?pageSize=not-a-number`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.pageSize).toBe(25);
  });

  it("refuses a different company from listing this company's invoices, regardless of page/pageSize", async () => {
    const response = await listCompanyInvoicesRoute(
      requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices?page=1&pageSize=50`, otherBuyerSessionToken),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(404);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await listCompanyInvoicesRoute(new NextRequest(`http://localhost/api/companies/${BUYER_COMPANY_ID}/invoices`), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(401);
  });

  it('returns an empty page (not an error) for a company with zero invoices', async () => {
    const emptyCompanyId = `test-company-invoices-empty-${Date.now()}`;
    await db.company.create({ data: { id: emptyCompanyId, name: 'Empty Invoices Co', country: 'GH', currency: 'GHS' } });
    await db.companyMembership.create({ data: { companyId: emptyCompanyId, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
    const emptySessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: emptyCompanyId })).token;

    const response = await listCompanyInvoicesRoute(requestFor(`/api/companies/${emptyCompanyId}/invoices`, emptySessionToken), {
      params: Promise.resolve({ companyId: emptyCompanyId }),
    });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);

    await db.companyMembership.deleteMany({ where: { companyId: emptyCompanyId } });
    await db.company.delete({ where: { id: emptyCompanyId } });
  });
});

describe('GET /api/suppliers/[supplierId]/invoices (pagination + tenant isolation, Phase 19)', () => {
  it("refuses an unrelated company from listing this supplier's invoices", async () => {
    const response = await listSupplierInvoicesRoute(requestFor(`/api/suppliers/${SUPPLIER_ID}/invoices`, otherBuyerSessionToken), {
      params: Promise.resolve({ supplierId: SUPPLIER_ID }),
    });
    expect(response.status).toBe(404);
  });
});

describe('GET /api/companies/[companyId]/invoices/aging-summary (Phase 19)', () => {
  it('aggregates the real outstanding-invoice total across the entire company history, not just one page', async () => {
    const response = await invoiceAgingSummaryRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices/aging-summary`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const summary = await response.json();
    // 30 PENDING invoices, none paid: 1 original (total 1125, possibly now PAID from the pay
    // test above) + 29 fixture rows (total 112 each, all still PENDING) = at least 29*112.
    expect(summary.count).toBeGreaterThanOrEqual(29);
    expect(summary.total).toBeGreaterThanOrEqual(29 * 112);
  });

  it("refuses a different company's aging summary", async () => {
    const response = await invoiceAgingSummaryRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/invoices/aging-summary`, otherBuyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(404);
  });
});
