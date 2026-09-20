// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as adminCompaniesRoute, POST as createCompanyRoute } from './route';
import { PATCH as updateCompanyRoute } from './[companyId]/route';
import { GET as companyMembersRoute } from './[companyId]/members/route';

/**
 * Phase 26 follow-up - /admin/companies previously read from a frontend-only localStorage mock
 * instead of a real backend endpoint. These are real, end-to-end tests against the actual route
 * with real sessions and real Postgres - the same shape as platformRoles.routes.test.ts's own
 * coverage for /api/orders, /api/payments, etc.
 */

const MANAGER_USER_ID = `test-admin-companies-manager-${Date.now()}`;
const SUPER_ADMIN_USER_ID = `test-admin-companies-super-admin-${Date.now()}`;
const LEGACY_ADMIN_USER_ID = `test-admin-companies-legacy-admin-${Date.now()}`;
const BUYER_USER_ID = `test-admin-companies-buyer-${Date.now()}`;

const MANAGER_COMPANY_ID = `test-admin-companies-manager-co-${Date.now()}`;
const SUPER_ADMIN_COMPANY_ID = `test-admin-companies-super-admin-co-${Date.now()}`;
const LEGACY_ADMIN_COMPANY_ID = `test-admin-companies-legacy-admin-co-${Date.now()}`;
const BUYER_COMPANY_ID = `test-admin-companies-buyer-co-${Date.now()}`;
// A platform-type company (isBuyer: false, isSupplier: false), the same shape as the real
// Platform Headquarters row - proves the directory never lists platform-type companies as if
// they were ordinary buyer customers.
const PLATFORM_TYPE_COMPANY_ID = `test-admin-companies-platform-type-co-${Date.now()}`;
// A supplier-only company - proves the directory never lists suppliers either.
const SUPPLIER_TYPE_COMPANY_ID = `test-admin-companies-supplier-type-co-${Date.now()}`;

let managerToken: string;
let superAdminToken: string;
let legacyAdminToken: string;
let buyerToken: string;

function req(token: string) {
  return new NextRequest('http://localhost/api/admin/companies', { headers: new Headers({ cookie: `session_token=${token}` }) });
}

function postReq(token: string, body: unknown) {
  return new NextRequest('http://localhost/api/admin/companies', {
    method: 'POST',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

function patchReq(url: string, token: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'PATCH',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

const createdCompanyIds: string[] = [];

beforeAll(async () => {
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'Test Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'Test Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: LEGACY_ADMIN_COMPANY_ID, name: 'Test Legacy Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Test Real Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: PLATFORM_TYPE_COMPANY_ID, name: 'Test Platform HQ Lookalike', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: SUPPLIER_TYPE_COMPANY_ID, name: 'Test Supplier Only Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: true } });

  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'Test Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'Test Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: LEGACY_ADMIN_USER_ID, name: 'Test Legacy Admin', email: `${LEGACY_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_USER_ID, name: 'Test Buyer', email: `${BUYER_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: LEGACY_ADMIN_COMPANY_ID, userId: LEGACY_ADMIN_USER_ID, role: 'PLATFORM_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  legacyAdminToken = (await createSession({ userId: LEGACY_ADMIN_USER_ID, activeCompanyId: LEGACY_ADMIN_COMPANY_ID })).token;
  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  // Companies created by the Add Company wizard tests may have generated real invitations, and
  // some of those may have been accepted by a brand-new User (created during acceptance, not
  // one of this file's own fixture users) - both need cleaning up, and CompanyInvitation's own
  // `invitedById` FK is RESTRICT (not cascade), so it must be cleared before SUPER_ADMIN_USER_ID
  // itself can be deleted below.
  const wizardInvitations = await db.companyInvitation.findMany({ where: { companyId: { in: createdCompanyIds } }, select: { acceptedUserId: true } });
  const acceptedUserIds = wizardInvitations.map((i) => i.acceptedUserId).filter((id): id is string => !!id);

  await db.auditLog.deleteMany({
    where: {
      OR: [
        { entityType: 'Company', entityId: 'LIST', actorId: { in: [SUPER_ADMIN_USER_ID, LEGACY_ADMIN_USER_ID] } },
        { entityType: 'Company', entityId: { in: createdCompanyIds } },
        { entityType: 'CompanyMembers' },
        { entityType: 'CompanyInvitation' },
        { actorId: { in: acceptedUserIds } },
      ],
    },
  });
  await db.companyMembership.deleteMany({ where: { companyId: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, LEGACY_ADMIN_COMPANY_ID, BUYER_COMPANY_ID] } } });
  // Removes the wizard-created invitations (and, via cascade, nothing else) before the inviting
  // user or the companies themselves are deleted.
  await db.companyInvitation.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await db.company.deleteMany({
    where: { id: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, LEGACY_ADMIN_COMPANY_ID, BUYER_COMPANY_ID, PLATFORM_TYPE_COMPANY_ID, SUPPLIER_TYPE_COMPANY_ID, ...createdCompanyIds] } },
  });
  await db.user.deleteMany({ where: { id: { in: [MANAGER_USER_ID, SUPER_ADMIN_USER_ID, LEGACY_ADMIN_USER_ID, BUYER_USER_ID, ...acceptedUserIds] } } });
});

describe('GET /api/admin/companies', () => {
  it('PLATFORM_SUPER_ADMIN can access the company list', async () => {
    const response = await adminCompaniesRoute(req(superAdminToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((c: { id: string }) => c.id === BUYER_COMPANY_ID)).toBe(true);
  });

  it('legacy PLATFORM_ADMIN can access it too - permission-equivalent to PLATFORM_SUPER_ADMIN', async () => {
    const response = await adminCompaniesRoute(req(legacyAdminToken));
    expect(response.status).toBe(200);
  });

  it('PLATFORM_MANAGER is denied - this endpoint is cross-company business data, not platform-operations metadata', async () => {
    const response = await adminCompaniesRoute(req(managerToken));
    expect(response.status).toBe(403);
  });

  it('an ordinary company user cannot enumerate other companies through this endpoint', async () => {
    const response = await adminCompaniesRoute(req(buyerToken));
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await adminCompaniesRoute(new NextRequest('http://localhost/api/admin/companies'));
    expect(response.status).toBe(401);
  });

  it('never lists a platform-type or supplier-only company as if it were a buyer company', async () => {
    const response = await adminCompaniesRoute(req(superAdminToken));
    const body: { id: string }[] = await response.json();
    const ids = body.map((c) => c.id);
    expect(ids).not.toContain(PLATFORM_TYPE_COMPANY_ID);
    expect(ids).not.toContain(SUPPLIER_TYPE_COMPANY_ID);
    expect(ids).not.toContain(MANAGER_COMPANY_ID);
    expect(ids).not.toContain(SUPER_ADMIN_COMPANY_ID);
  });

  it('returns only the fields the Companies UI needs - never credit limit, tax id, email, or any other sensitive/unrelated field', async () => {
    const response = await adminCompaniesRoute(req(superAdminToken));
    const body: Record<string, unknown>[] = await response.json();
    const row = body.find((c) => c.id === BUYER_COMPANY_ID);
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual(['country', 'createdAt', 'creditTerms', 'currency', 'id', 'memberCount', 'name', 'status'].sort());
    expect(row).not.toHaveProperty('creditLimit');
    expect(row).not.toHaveProperty('creditAvailable');
    expect(row).not.toHaveProperty('taxId');
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('registrationNumber');
    expect((row as { memberCount: number }).memberCount).toBe(1);
  });

  it('records a SUPER_ADMIN_CROSS_COMPANY_READ audit entry for the Super Admin listing every company', async () => {
    await db.auditLog.deleteMany({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST' } });

    const response = await adminCompaniesRoute(req(superAdminToken));
    expect(response.status).toBe(200);

    const entry = await db.auditLog.findFirst({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST', actorId: SUPER_ADMIN_USER_ID } });
    expect(entry).not.toBeNull();
  });

  it('PLATFORM_MANAGER never generates a cross-company-read audit entry, since it is denied before reaching the data', async () => {
    await db.auditLog.deleteMany({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST', actorId: MANAGER_USER_ID } });

    const response = await adminCompaniesRoute(req(managerToken));
    expect(response.status).toBe(403);

    const entry = await db.auditLog.findFirst({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST', actorId: MANAGER_USER_ID } });
    expect(entry).toBeNull();
  });
});

describe('POST /api/admin/companies (Add Company wizard)', () => {
  function wizardBody(overrides: Record<string, unknown> = {}) {
    return {
      name: `Test Wizard Co ${Date.now()}-${Math.random().toString(36).slice(2)}`,
      legalName: 'Test Wizard Co Ltd.',
      registrationNumber: `REG-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      companyType: 'LIMITED_LIABILITY',
      email: 'contact@wizardco.example',
      phone: '+233 30 123 4567',
      website: 'https://wizardco.example',
      businessRole: 'BUYER',
      addressLine1: '14 Independence Avenue',
      country: 'GH',
      currency: 'GHS',
      ...overrides,
    };
  }

  it('1. PLATFORM_SUPER_ADMIN can create a company', async () => {
    const body = wizardBody();
    const response = await createCompanyRoute(postReq(superAdminToken, body));
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody.name).toBe(body.name);
    createdCompanyIds.push(responseBody.id);

    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_COMPANY_CREATED', entityId: responseBody.id } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(SUPER_ADMIN_USER_ID);
  });

  it('2. legacy PLATFORM_ADMIN can create a company if the existing permission allows', async () => {
    const response = await createCompanyRoute(postReq(legacyAdminToken, wizardBody()));
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    createdCompanyIds.push(responseBody.id);
  });

  it('3. PLATFORM_MANAGER is denied', async () => {
    const response = await createCompanyRoute(postReq(managerToken, wizardBody()));
    expect(response.status).toBe(403);
  });

  it('4. an ordinary company user is denied', async () => {
    const response = await createCompanyRoute(postReq(buyerToken, wizardBody()));
    expect(response.status).toBe(403);
  });

  it('5. required fields are validated (missing legalName/registrationNumber/etc.)', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, { name: 'Missing Fields Co', country: 'GH', currency: 'GHS' }));
    expect(response.status).toBe(422);
  });

  it('6. an invalid email is rejected', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ email: 'not-an-email' })));
    expect(response.status).toBe(422);
  });

  it('7. an invalid website URL is rejected', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ website: 'not-a-url' })));
    expect(response.status).toBe(422);
  });

  it('8. an invalid business role is rejected', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ businessRole: 'PLATFORM_SUPER_ADMIN' })));
    expect(response.status).toBe(422);
  });

  it('9. Buyer sets isBuyer=true/isSupplier=false', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ businessRole: 'BUYER' })));
    const body = await response.json();
    createdCompanyIds.push(body.id);
    expect(body.isBuyer).toBe(true);
    expect(body.isSupplier).toBe(false);
  });

  it('10. Supplier sets isBuyer=false/isSupplier=true', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ businessRole: 'SUPPLIER' })));
    const body = await response.json();
    createdCompanyIds.push(body.id);
    expect(body.isBuyer).toBe(false);
    expect(body.isSupplier).toBe(true);
  });

  it('11. Buyer + Supplier sets both true', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ businessRole: 'BUYER_AND_SUPPLIER' })));
    const body = await response.json();
    createdCompanyIds.push(body.id);
    expect(body.isBuyer).toBe(true);
    expect(body.isSupplier).toBe(true);
  });

  it('12. the initial administrator role is validated (rejects a non-OWNER/ADMIN role)', async () => {
    const response = await createCompanyRoute(
      postReq(superAdminToken, wizardBody({ initialAdministrator: { name: 'Bad Role', email: `bad-role-${Date.now()}@example.test`, role: 'EMPLOYEE' } })),
    );
    expect(response.status).toBe(422);
  });

  it('13 & 14. City/Region are not required - only Address Line 1 and Country', async () => {
    const body = wizardBody();
    const response = await createCompanyRoute(postReq(superAdminToken, body));
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    createdCompanyIds.push(responseBody.id);
    const address = await db.address.findFirst({ where: { companyId: responseBody.id } });
    expect(address).not.toBeNull();
    expect(address?.line1).toBe(body.addressLine1);
    expect(address?.city).toBeNull();
    expect(address?.region).toBeNull();
  });

  it('15 & 16. no Branches or Departments are created', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody()));
    const body = await response.json();
    createdCompanyIds.push(body.id);
    const branchCount = await db.branch.count({ where: { companyId: body.id } });
    const departmentCount = await db.department.count({ where: { companyId: body.id } });
    expect(branchCount).toBe(0);
    expect(departmentCount).toBe(0);
  });

  it('17. company creation is audited with safe, non-sensitive fields only', async () => {
    const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ bankAccountNumber: '1234567890' })));
    const body = await response.json();
    createdCompanyIds.push(body.id);
    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_COMPANY_CREATED', entityId: body.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValue)).not.toMatch(/1234567890/);
    expect(JSON.stringify(audit)).not.toMatch(/bankAccountNumber/i);
  });

  it('18. a duplicate registration number is handled safely (409, not a silent duplicate)', async () => {
    const regNumber = `DUPLICATE-REG-${Date.now()}`;
    const first = await createCompanyRoute(postReq(superAdminToken, wizardBody({ registrationNumber: regNumber })));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    createdCompanyIds.push(firstBody.id);

    const second = await createCompanyRoute(postReq(superAdminToken, wizardBody({ registrationNumber: regNumber })));
    expect(second.status).toBe(409);
  });

  describe('Initial administrator', () => {
    it('19, 22, 25, 26, 27, 28. invitation is created correctly, with the intended role, a secure single-use expiring token that activates the right membership', async () => {
      const adminEmail = `initial-admin-${Date.now()}@example.test`;
      const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ initialAdministrator: { name: 'Initial Owner', email: adminEmail, role: 'OWNER' } })));
      expect(response.status).toBe(200);
      const body = await response.json();
      createdCompanyIds.push(body.id);

      expect(body.invitation).toBeDefined();
      expect(body.invitation.email).toBe(adminEmail);
      expect(body.invitation.role).toBe('OWNER');
      expect(typeof body.invitation.token).toBe('string');

      const invitationRow = await db.companyInvitation.findFirst({ where: { companyId: body.id, email: adminEmail } });
      expect(invitationRow).not.toBeNull();
      expect(invitationRow!.tokenHash).not.toBe(body.invitation.token); // 25 - never stored raw
      expect(invitationRow!.expiresAt.getTime()).toBeGreaterThan(Date.now()); // 27 - expires in the future

      const { POST: acceptRoute } = await import('@/app/api/invitations/accept/route');
      const acceptResponse = await acceptRoute(
        new NextRequest('http://localhost/api/invitations/accept', {
          method: 'POST',
          headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
          body: JSON.stringify({ token: body.invitation.token, password: 'a-strong-password-99' }),
        }),
      );
      expect(acceptResponse.status).toBe(200);
      const acceptBody = await acceptResponse.json();

      const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: body.id, userId: acceptBody.userId } } });
      expect(membership?.status).toBe('ACTIVE'); // 28
      expect(membership?.role).toBe('OWNER');

      // 26 - single-use: replaying the same token must fail.
      const replay = await acceptRoute(
        new NextRequest('http://localhost/api/invitations/accept', {
          method: 'POST',
          headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
          body: JSON.stringify({ token: body.invitation.token, password: 'another-password-1' }),
        }),
      );
      expect(replay.status).toBe(422);
    });

    it('20, 21, 29. an existing user can be associated without creating a duplicate, and other/multi-company memberships remain intact', async () => {
      const existingEmail = `existing-for-new-co-${Date.now()}@example.test`;
      await db.user.create({ data: { email: existingEmail, name: 'Existing Person', passwordHash: 'x' } });
      const existingUser = await db.user.findUniqueOrThrow({ where: { email: existingEmail } });
      // A real, pre-existing membership at an unrelated company - must remain untouched.
      const unrelatedCoId = `test-unrelated-co-${Date.now()}`;
      await db.company.create({ data: { id: unrelatedCoId, name: 'Unrelated Co', country: 'GH', currency: 'GHS', isBuyer: true } });
      await db.companyMembership.create({ data: { companyId: unrelatedCoId, userId: existingUser.id, role: 'BUYER', status: 'ACTIVE', joinedAt: new Date() } });

      const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ initialAdministrator: { name: 'Existing Person', email: existingEmail, role: 'ADMIN' } })));
      const body = await response.json();
      createdCompanyIds.push(body.id);

      const { POST: acceptRoute } = await import('@/app/api/invitations/accept/route');
      const acceptResponse = await acceptRoute(
        new NextRequest('http://localhost/api/invitations/accept', {
          method: 'POST',
          headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
          body: JSON.stringify({ token: body.invitation.token }),
        }),
      );
      expect(acceptResponse.status).toBe(200);
      const acceptBody = await acceptResponse.json();
      expect(acceptBody.userId).toBe(existingUser.id); // no duplicate User

      const userCount = await db.user.count({ where: { email: existingEmail } });
      expect(userCount).toBe(1);

      const unrelatedMembership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: unrelatedCoId, userId: existingUser.id } } });
      expect(unrelatedMembership?.status).toBe('ACTIVE'); // untouched
      expect(unrelatedMembership?.role).toBe('BUYER');

      await db.companyMembership.deleteMany({ where: { companyId: unrelatedCoId } });
      await db.company.delete({ where: { id: unrelatedCoId } });
      await db.user.delete({ where: { id: existingUser.id } });
    });

    it('23. a platform role cannot be assigned as the initial administrator', async () => {
      const response = await createCompanyRoute(
        postReq(superAdminToken, wizardBody({ initialAdministrator: { name: 'Should Fail', email: `platform-attempt-${Date.now()}@example.test`, role: 'PLATFORM_SUPER_ADMIN' } })),
      );
      expect(response.status).toBe(422);
    });

    it('24. no plaintext password is ever created/stored for a brand-new initial administrator', async () => {
      const adminEmail = `no-plaintext-${Date.now()}@example.test`;
      const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ initialAdministrator: { name: 'No Plaintext', email: adminEmail, role: 'OWNER' } })));
      const body = await response.json();
      createdCompanyIds.push(body.id);
      expect(JSON.stringify(body)).not.toMatch(/passwordHash/i);
      expect(body).not.toHaveProperty('password');
    });
  });

  describe('Banking', () => {
    it('30 & 31. bank information is persisted only where supported and not exposed in the response', async () => {
      const response = await createCompanyRoute(
        postReq(superAdminToken, wizardBody({ bankName: 'Test Bank', bankAccountName: 'Test Wizard Co Ltd.', bankAccountNumber: '9988776655' })),
      );
      const body = await response.json();
      createdCompanyIds.push(body.id);
      expect(JSON.stringify(body)).not.toMatch(/9988776655/);

      const stored = await db.company.findUnique({ where: { id: body.id } });
      expect(stored?.bankName).toBe('Test Bank');
      expect(stored?.bankAccountNumber).toBe('9988776655');
    });

    it('32. bank details never appear in audit metadata', async () => {
      const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ bankAccountNumber: '5544332211' })));
      const body = await response.json();
      createdCompanyIds.push(body.id);
      const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_COMPANY_CREATED', entityId: body.id } });
      expect(JSON.stringify(audit)).not.toMatch(/5544332211/);
    });

    it("33. bank details never appear in the company directory (list) response", async () => {
      const response = await createCompanyRoute(postReq(superAdminToken, wizardBody({ bankAccountNumber: '1122334455' })));
      const body = await response.json();
      createdCompanyIds.push(body.id);

      const listResponse = await adminCompaniesRoute(req(superAdminToken));
      const listBody: Record<string, unknown>[] = await listResponse.json();
      expect(JSON.stringify(listBody)).not.toMatch(/1122334455/);
      expect(JSON.stringify(listBody)).not.toMatch(/bankAccountNumber/i);
    });
  });
});

describe('PATCH /api/admin/companies/[companyId] (Phase 28 - platform company editing)', () => {
  it('PLATFORM_SUPER_ADMIN can update an existing company\'s profile', async () => {
    const response = await updateCompanyRoute(
      patchReq(`/api/admin/companies/${BUYER_COMPANY_ID}`, superAdminToken, { industry: 'Testing Industry' }),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.industry).toBe('Testing Industry');

    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_COMPANY_UPDATED', entityId: BUYER_COMPANY_ID } });
    expect(audit).not.toBeNull();
  });

  it('PLATFORM_MANAGER cannot update a company', async () => {
    const response = await updateCompanyRoute(
      patchReq(`/api/admin/companies/${BUYER_COMPANY_ID}`, managerToken, { industry: 'Should Not Apply' }),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it('an ordinary company user cannot update another company (or even their own) through this platform-admin route', async () => {
    const response = await updateCompanyRoute(
      patchReq(`/api/admin/companies/${BUYER_COMPANY_ID}`, buyerToken, { industry: 'Should Not Apply' }),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it('never accepts id/ownership/role-shaped fields - the schema has no fields for them', async () => {
    const response = await updateCompanyRoute(
      patchReq(`/api/admin/companies/${BUYER_COMPANY_ID}`, superAdminToken, { id: 'hacked-id', isBuyer: false, parentGroupId: 'other-group' }),
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    // Zod's default parsing simply ignores unknown keys - the request still succeeds, but only
    // real, allowed fields (none supplied here) are ever applied.
    expect(response.status).toBe(200);
    const company = await db.company.findUnique({ where: { id: BUYER_COMPANY_ID } });
    expect(company?.id).toBe(BUYER_COMPANY_ID);
    expect(company?.isBuyer).toBe(true);
  });
});

describe('GET /api/admin/companies/[companyId]/members (Phase 28 - controlled member viewing)', () => {
  it('PLATFORM_SUPER_ADMIN can view a specific company\'s members, with only safe fields', async () => {
    const response = await companyMembersRoute(
      req(superAdminToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBeGreaterThan(0);
    const member = body.find((m: { userId: string }) => m.userId === BUYER_USER_ID);
    expect(member).toBeDefined();
    expect(member.role).toBe('OWNER');
    expect(Object.keys(member).sort()).toEqual(['email', 'joinedAt', 'name', 'role', 'status', 'userId'].sort());
    expect(member).not.toHaveProperty('passwordHash');
  });

  it('PLATFORM_MANAGER cannot view company members', async () => {
    const response = await companyMembersRoute(
      req(managerToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it('an ordinary company user cannot enumerate another company\'s members through this platform route', async () => {
    const response = await companyMembersRoute(
      req(buyerToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: MANAGER_COMPANY_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it('records a cross-company member-read audit entry', async () => {
    await db.auditLog.deleteMany({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'CompanyMembers', entityId: BUYER_COMPANY_ID } });

    const response = await companyMembersRoute(
      req(superAdminToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);

    const entry = await db.auditLog.findFirst({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'CompanyMembers', entityId: BUYER_COMPANY_ID } });
    expect(entry).not.toBeNull();
  });
});
