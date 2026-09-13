// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as getCompanyRoute } from '@/app/api/companies/[companyId]/route';
import { GET as listDepartmentsRoute, POST as createDepartmentRoute } from '@/app/api/companies/[companyId]/departments/route';
import { DELETE as deleteDepartmentRoute } from '@/app/api/companies/[companyId]/departments/[departmentId]/route';

/**
 * Phase 14, Stage 3 - regression suite at the real API boundary: authentication, permission,
 * and tenant-isolation, exercised exactly as a live request would (route handler -> auth
 * context -> service -> Postgres), not just the service functions in isolation. Uses a real
 * minted session (via createSession, the same function /api/auth/login calls) for a seeded
 * PROCUREMENT_MANAGER-at-company-acme-gh user, plus a dedicated scratch company this suite
 * owns end-to-end.
 */

const TEST_COMPANY_ID = `test-company-routes-${Date.now()}`;
const OWNER_USER_ID = 'user-john-doe'; // seeded PROCUREMENT_MANAGER at company-acme-gh (prisma/seed.ts)

let sessionToken: string;

function requestFor(url: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({ cookie: `session_token=${sessionToken}`, origin: 'http://localhost' }),
  });
}

beforeAll(async () => {
  await db.company.create({
    data: { id: TEST_COMPANY_ID, name: 'Company Routes Test Co', country: 'GH', currency: 'GHS', isBuyer: true },
  });
  await db.companyMembership.create({
    data: { companyId: TEST_COMPANY_ID, userId: OWNER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const created = await createSession({ userId: OWNER_USER_ID, activeCompanyId: TEST_COMPANY_ID });
  sessionToken = created.token;
});

afterAll(async () => {
  await db.companyMembership.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('GET /api/companies/[companyId] (auth boundary)', () => {
  it('refuses an unauthenticated request', async () => {
    const request = new NextRequest(`http://localhost/api/companies/${TEST_COMPANY_ID}`);
    const response = await getCompanyRoute(request, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(response.status).toBe(401);
  });

  it("refuses a request for a company the caller isn't a member of", async () => {
    const request = requestFor(`/api/companies/company-not-mine`);
    const response = await getCompanyRoute(request, { params: Promise.resolve({ companyId: 'company-not-mine' }) });
    expect(response.status).toBe(404);
  });

  it('allows a request for the caller’s own company', async () => {
    const request = requestFor(`/api/companies/${TEST_COMPANY_ID}`);
    const response = await getCompanyRoute(request, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(TEST_COMPANY_ID);
  });
});

describe('Departments API (create/list/delete through the real route stack)', () => {
  it('creates, lists, and deletes a department end-to-end', async () => {
    const createRequest = requestFor(`/api/companies/${TEST_COMPANY_ID}/departments`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Ops' }),
    });
    const createResponse = await createDepartmentRoute(createRequest, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(createResponse.status).toBe(200);
    const department = await createResponse.json();
    expect(department.name).toBe('Ops');

    const listRequest = requestFor(`/api/companies/${TEST_COMPANY_ID}/departments`);
    const listResponse = await listDepartmentsRoute(listRequest, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    const list = await listResponse.json();
    expect(list.some((d: { id: string }) => d.id === department.id)).toBe(true);

    const deleteRequest = requestFor(`/api/companies/${TEST_COMPANY_ID}/departments/${department.id}`, { method: 'DELETE' });
    const deleteResponse = await deleteDepartmentRoute(deleteRequest, {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, departmentId: department.id }),
    });
    expect(deleteResponse.status).toBe(200);
  });

  it("refuses creating a department for a company the caller isn't a member of", async () => {
    const request = requestFor(`/api/companies/company-not-mine/departments`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    const response = await createDepartmentRoute(request, { params: Promise.resolve({ companyId: 'company-not-mine' }) });
    expect(response.status).toBe(404);
  });

  it('rejects a mutation with no Origin header (CSRF guard)', async () => {
    const request = new NextRequest(`http://localhost/api/companies/${TEST_COMPANY_ID}/departments`, {
      method: 'POST',
      headers: { cookie: `session_token=${sessionToken}` },
      body: JSON.stringify({ name: 'No Origin' }),
    });
    const response = await createDepartmentRoute(request, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(response.status).toBe(403);
  });
});
