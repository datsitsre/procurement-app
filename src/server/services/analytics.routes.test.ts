// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as buyerAnalyticsRoute } from '@/app/api/companies/[companyId]/analytics/route';
import { GET as platformAnalyticsRoute } from '@/app/api/analytics/route';

/**
 * Phase 14, Stage 10 - regression suite at the real API boundary for analytics tenant isolation
 * and the platform-analytics permission gate (never checked in the mock at all).
 */

const BUYER_COMPANY_ID = `test-company-analytics-routes-${Date.now()}`;
const BUYER_USER_ID = 'user-john-doe'; // seeded OWNER at company-acme-gh
const OTHER_BUYER_ACTIVE_COMPANY_ID = 'company-acme-ng'; // John Doe is also OWNER here, a genuinely different tenant

let buyerSessionToken: string;
let otherBuyerSessionToken: string;

function requestFor(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, { headers: new Headers({ cookie: `session_token=${token}` }) });
}

beforeAll(async () => {
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Analytics Routes Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  buyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  otherBuyerSessionToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: OTHER_BUYER_ACTIVE_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.companyMembership.deleteMany({ where: { companyId: BUYER_COMPANY_ID } });
  await db.company.delete({ where: { id: BUYER_COMPANY_ID } }).catch(() => undefined);
});

describe('GET /api/companies/[companyId]/analytics (tenant isolation)', () => {
  it("refuses a different company's own analytics", async () => {
    const response = await buyerAnalyticsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/analytics`, otherBuyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('allows the owning company', async () => {
    const response = await buyerAnalyticsRoute(requestFor(`/api/companies/${BUYER_COMPANY_ID}/analytics`, buyerSessionToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.totalOrders).toBe(0);
  });
});

describe('GET /api/analytics (platform admin gate)', () => {
  it('refuses a regular buyer, who has no ANALYTICS_READ permission', async () => {
    const response = await platformAnalyticsRoute(requestFor('/api/analytics', buyerSessionToken));
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await platformAnalyticsRoute(new NextRequest('http://localhost/api/analytics'));
    expect(response.status).toBe(401);
  });
});
