// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as getCompanyRoute } from '@/app/api/companies/[companyId]/route';
import { GET as listDepartmentsRoute, POST as createDepartmentRoute } from '@/app/api/companies/[companyId]/departments/route';
import { DELETE as deleteDepartmentRoute } from '@/app/api/companies/[companyId]/departments/[departmentId]/route';
import { GET as listTeamRoute, POST as addTeamMemberRoute } from '@/app/api/companies/[companyId]/team/route';
import { PATCH as updateTeamMemberRoute } from '@/app/api/companies/[companyId]/team/[userId]/route';

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

const NEW_TEAM_MEMBER_EMAIL = `routes-new-team-member-${Date.now()}@example.test`;

afterAll(async () => {
  await db.companyMembership.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.user.deleteMany({ where: { email: NEW_TEAM_MEMBER_EMAIL } });
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

describe('POST /api/companies/[companyId]/team (add a team member through the real route stack)', () => {
  it('rejects a mutation with no Origin header (CSRF guard, via requireCompanyAccess itself)', async () => {
    const request = new NextRequest(`http://localhost/api/companies/${TEST_COMPANY_ID}/team`, {
      method: 'POST',
      headers: { cookie: `session_token=${sessionToken}` },
      body: JSON.stringify({ email: 'no-origin@example.test', role: 'EMPLOYEE' }),
    });
    const response = await addTeamMemberRoute(request, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(response.status).toBe(403);
  });

  it("refuses adding a team member to a company the caller isn't a member of", async () => {
    const request = requestFor(`/api/companies/company-not-mine/team`, {
      method: 'POST',
      body: JSON.stringify({ email: 'hijacked@example.test', name: 'Hijacked', role: 'EMPLOYEE' }),
    });
    const response = await addTeamMemberRoute(request, { params: Promise.resolve({ companyId: 'company-not-mine' }) });
    expect(response.status).toBe(404);
  });

  it("refuses a role this company's own workspace can't grant", async () => {
    const request = requestFor(`/api/companies/${TEST_COMPANY_ID}/team`, {
      method: 'POST',
      body: JSON.stringify({ email: 'wrong-role@example.test', name: 'Wrong Role', role: 'SUPPLIER_ADMIN' }),
    });
    const response = await addTeamMemberRoute(request, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(response.status).toBe(422);
  });

  it('adds a brand-new team member end-to-end, with a real temporary password, then lists them', async () => {
    const addRequest = requestFor(`/api/companies/${TEST_COMPANY_ID}/team`, {
      method: 'POST',
      body: JSON.stringify({ email: NEW_TEAM_MEMBER_EMAIL, name: 'Routes New Member', role: 'EMPLOYEE', department: 'Ops' }),
    });
    const addResponse = await addTeamMemberRoute(addRequest, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(addResponse.status).toBe(200);
    const added = await addResponse.json();
    expect(added.user.email).toBe(NEW_TEAM_MEMBER_EMAIL);
    expect(added.temporaryPassword).toBeTruthy();

    const listRequest = requestFor(`/api/companies/${TEST_COMPANY_ID}/team`);
    const listResponse = await listTeamRoute(listRequest, { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    const list = await listResponse.json();
    expect(list.some((m: { user: { email: string } }) => m.user.email === NEW_TEAM_MEMBER_EMAIL)).toBe(true);
  });
});

describe('PATCH /api/companies/[companyId]/team/[userId] (edit an existing team member through the real route stack)', () => {
  it("refuses editing a member of a company the caller isn't a member of", async () => {
    const request = requestFor(`/api/companies/company-not-mine/team/${OWNER_USER_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'EMPLOYEE' }),
    });
    const response = await updateTeamMemberRoute(request, { params: Promise.resolve({ companyId: 'company-not-mine', userId: OWNER_USER_ID }) });
    expect(response.status).toBe(404);
  });

  it('refuses a role this company cannot grant, then edits the real member (added earlier in this file) end-to-end', async () => {
    // Reuses the account the "adds a brand-new team member" test above created - a real EMPLOYEE
    // member of TEST_COMPANY_ID by this point in the file.
    const target = await db.user.findUniqueOrThrow({ where: { email: NEW_TEAM_MEMBER_EMAIL } });

    const wrongRole = requestFor(`/api/companies/${TEST_COMPANY_ID}/team/${target.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'SUPPLIER_ADMIN' }),
    });
    const wrongRoleResponse = await updateTeamMemberRoute(wrongRole, { params: Promise.resolve({ companyId: TEST_COMPANY_ID, userId: target.id }) });
    expect(wrongRoleResponse.status).toBe(422);

    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const editRequest = requestFor(`/api/companies/${TEST_COMPANY_ID}/team/${target.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'BUYER', department: 'Procurement', name: 'Routes Edited Name', avatarUrl: avatar }),
    });
    const editResponse = await updateTeamMemberRoute(editRequest, { params: Promise.resolve({ companyId: TEST_COMPANY_ID, userId: target.id }) });
    expect(editResponse.status).toBe(200);
    const updated = await editResponse.json();
    expect(updated.membership.role).toBe('BUYER');
    expect(updated.membership.department).toBe('Procurement');
    expect(updated.user.name).toBe('Routes Edited Name');
    expect(updated.user.avatarUrl).toBe(avatar);
  });
});

describe('GET /api/companies/[companyId] - parentGroup resolution (Phase 19)', () => {
  it("includes the real group name for a company that belongs to one, resolved server-side rather than from static data", async () => {
    // company-acme-gh is real seed data, a member of the real "group-acme" CompanyGroup
    // ("Acme Technologies") - John Doe (this suite's own OWNER_USER_ID) is a real OWNER there,
    // but tenant checks scope strictly to the session's *active* company (Phase 18's own
    // finding), so this needs its own session with company-acme-gh actually active.
    const acmeGhToken = (await createSession({ userId: OWNER_USER_ID, activeCompanyId: 'company-acme-gh' })).token;
    const response = await getCompanyRoute(
      new NextRequest('http://localhost/api/companies/company-acme-gh', { headers: new Headers({ cookie: `session_token=${acmeGhToken}`, origin: 'http://localhost' }) }),
      { params: Promise.resolve({ companyId: 'company-acme-gh' }) },
    );
    expect(response.status).toBe(200);
    const company = await response.json();
    expect(company.parentGroupId).toBe('group-acme');
    expect(company.parentGroupName).toBe('Acme Technologies');
  });

  it('omits parentGroupName for a company with no parent group, rather than leaking an unrelated group', async () => {
    const response = await getCompanyRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}`), { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(response.status).toBe(200);
    const company = await response.json();
    expect(company.parentGroupId).toBeUndefined();
    expect(company.parentGroupName).toBeUndefined();
  });
});

describe('POST /api/auth/login - session payload parentGroup resolution (Phase 19)', () => {
  it("a real login response includes parentGroupName for every membership company that has a group, and only those", async () => {
    const { POST: loginRoute } = await import('@/app/api/auth/login/route');
    const response = await loginRoute(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json', origin: 'http://localhost' }),
        body: JSON.stringify({ email: 'john.doe@acmetech.example', password: 'password123' }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    const acmeGh = payload.companies.find((c: { id: string }) => c.id === 'company-acme-gh');
    expect(acmeGh.parentGroupId).toBe('group-acme');
    expect(acmeGh.parentGroupName).toBe('Acme Technologies');
    // Never trusted/hardcoded client-side - every value here came from this one real response.
    const ungroupedCompanies = payload.companies.filter((c: { parentGroupId?: string }) => !c.parentGroupId);
    for (const c of ungroupedCompanies) {
      expect(c.parentGroupName).toBeUndefined();
    }
  });
});
