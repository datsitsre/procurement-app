// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listCompanyPaymentsRoute } from '@/app/api/companies/[companyId]/payments/route';
import { GET as listSupplierPaymentsRoute } from '@/app/api/suppliers/[supplierId]/payments/route';
import { GET as paidThisMonthRoute } from '@/app/api/companies/[companyId]/payments/paid-this-month/route';

/**
 * Phase 19, section 1/6 - regression suite at the real API boundary for the newly-paginated
 * company/supplier payment list endpoints, and the new "paid this month" aggregate that replaced
 * the finance/supplier dashboards' own client-side `.reduce()` over the *entire* payment history.
 */

const BUYER_COMPANY_ID = `test-company-payments-routes-${Date.now()}`;
const SUPPLIER_ID = `test-supplier-payments-routes-${Date.now()}`;
const SUPPLIER_COMPANY_ID = `${SUPPLIER_ID}-company`;

const BUYER_USER_ID = 'user-john-doe'; // seeded OWNER at company-acme-gh
const OTHER_BUYER_ACTIVE_COMPANY_ID = 'company-acme-ng'; // John Doe is also OWNER here

let buyerSessionToken: string;
let otherBuyerSessionToken: string;

function requestFor(url: string, token?: string) {
  return new NextRequest(`http://localhost${url}`, {
    headers: token ? new Headers({ cookie: `session_token=${token}` }) : undefined,
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Payments Routes Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: SUPPLIER_COMPANY_ID, name: 'Payments Routes Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: SUPPLIER_ID,
      companyId: SUPPLIER_COMPANY_ID,
      name: 'Payments Routes Supplier',
      slug: `payments-routes-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  // 30 payments - enough to exercise a second, non-final page at the default pageSize of 25.
  // Half fall inside the current calendar month (for the "paid this month" aggregate), half are
  // pushed to last month so the aggregate has something real to exclude, not just include.
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: `test-payment-routes-${Date.now()}-${i}`,
    companyId: BUYER_COMPANY_ID,
    supplierId: SUPPLIER_ID,
    amount: 500 + i,
    method: 'CARD' as const,
    status: 'PAID' as const,
    reference: `PAY-ROUTES-${Date.now()}-${i}`,
    createdAt: i < 15 ? new Date(now.getTime() - i * 60_000) : lastMonth,
  }));
  await db.payment.createMany({ data: rows });

  buyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  otherBuyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: OTHER_BUYER_ACTIVE_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.paymentTransaction.deleteMany({ where: { payment: { companyId: BUYER_COMPANY_ID } } });
  await db.payment.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.companyMembership.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.supplierProfile.delete({ where: { id: SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: SUPPLIER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: BUYER_COMPANY_ID } }).catch(() => undefined);
});

describe('GET /api/companies/[companyId]/payments (pagination, Phase 19)', () => {
  it('returns a real Page envelope, scoped to the owning company', async () => {
    const response = await listCompanyPaymentsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.total).toBe(30);
    expect(page.items).toHaveLength(25);
    expect(page.items.every((p: { companyId: string }) => p.companyId === BUYER_COMPANY_ID)).toBe(true);
  });

  it('page 2 returns the remaining 5 rows, with no overlap and no gaps', async () => {
    const page1 = await (
      await listCompanyPaymentsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments?page=1`, buyerSessionToken), {
        params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
      })
    ).json();
    const page2 = await (
      await listCompanyPaymentsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments?page=2`, buyerSessionToken), {
        params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
      })
    ).json();
    expect(page2.items).toHaveLength(5);
    const ids1 = page1.items.map((p: { id: string }) => p.id);
    const ids2 = page2.items.map((p: { id: string }) => p.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    expect(new Set([...ids1, ...ids2]).size).toBe(30);
  });

  it('clamps an excessive pageSize to the configured maximum', async () => {
    const response = await listCompanyPaymentsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments?pageSize=999999`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    const page = await response.json();
    expect(page.pageSize).toBeLessThanOrEqual(100);
  });

  it('falls back to page 1 for an invalid page number', async () => {
    const response = await listCompanyPaymentsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments?page=abc`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    const page = await response.json();
    expect(page.page).toBe(1);
  });

  it("refuses a different company from listing this company's payments", async () => {
    const response = await listCompanyPaymentsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments`, otherBuyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await listCompanyPaymentsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments`), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(401);
  });
});

describe("GET /api/suppliers/[supplierId]/payments (tenant isolation, Phase 19)", () => {
  it("refuses an unrelated company from listing this supplier's payments", async () => {
    const response = await listSupplierPaymentsRoute(requestFor(`/api/suppliers/${SUPPLIER_ID}/payments`, otherBuyerSessionToken), {
      params: Promise.resolve({ supplierId: SUPPLIER_ID }),
    });
    expect(response.status).toBe(404);
  });
});

describe('GET /api/companies/[companyId]/payments/paid-this-month (Phase 19)', () => {
  it('sums only payments from the current calendar month, real database aggregation across the entire history', async () => {
    const response = await paidThisMonthRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments/paid-this-month`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const { amount } = await response.json();
    // 15 rows fall in the current month, amounts 500..514 -> sum = 15*500 + (0+1+...+14) = 7500+105.
    expect(amount).toBe(15 * 500 + 105);
  });

  it("refuses a different company's paid-this-month total", async () => {
    const response = await paidThisMonthRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/payments/paid-this-month`, otherBuyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(404);
  });
});
