// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { POST as suspendRoute } from './route';
import { POST as activateRoute } from '../activate/route';
import { GET as companyMembersRoute } from '../members/route';
import { GET as purchaseOrdersRoute } from '@/app/api/companies/[companyId]/purchase-orders/route';

/**
 * Company Organization Management (suspend/activate) - Phase 11 security coverage. Real,
 * end-to-end tests against the actual routes with real sessions and real Postgres, following the
 * same fixture pattern as ../../route.test.ts.
 */

const SUPER_ADMIN_USER_ID = `test-suspend-super-admin-${Date.now()}`;
const LEGACY_ADMIN_USER_ID = `test-suspend-legacy-admin-${Date.now()}`;
const MANAGER_USER_ID = `test-suspend-manager-${Date.now()}`;
const TARGET_OWNER_USER_ID = `test-suspend-target-owner-${Date.now()}`;
const OTHER_BUYER_USER_ID = `test-suspend-other-buyer-${Date.now()}`;

const SUPER_ADMIN_COMPANY_ID = `test-suspend-super-admin-co-${Date.now()}`;
const LEGACY_ADMIN_COMPANY_ID = `test-suspend-legacy-admin-co-${Date.now()}`;
const MANAGER_COMPANY_ID = `test-suspend-manager-co-${Date.now()}`;
const TARGET_COMPANY_ID = `test-suspend-target-co-${Date.now()}`;
const OTHER_BUYER_COMPANY_ID = `test-suspend-other-buyer-co-${Date.now()}`;

let superAdminToken: string;
let legacyAdminToken: string;
let managerToken: string;
let targetOwnerToken: string;
let otherBuyerToken: string;

function postReq(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost' }),
  });
}

function getReq(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, { headers: new Headers({ cookie: `session_token=${token}` }) });
}

beforeAll(async () => {
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'Test Suspend Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: LEGACY_ADMIN_COMPANY_ID, name: 'Test Suspend Legacy Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'Test Suspend Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: TARGET_COMPANY_ID, name: 'Test Suspend Target Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: OTHER_BUYER_COMPANY_ID, name: 'Test Suspend Other Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });

  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'Test Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: LEGACY_ADMIN_USER_ID, name: 'Test Legacy Admin', email: `${LEGACY_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'Test Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: TARGET_OWNER_USER_ID, name: 'Test Target Owner', email: `${TARGET_OWNER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: OTHER_BUYER_USER_ID, name: 'Test Other Buyer', email: `${OTHER_BUYER_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: LEGACY_ADMIN_COMPANY_ID, userId: LEGACY_ADMIN_USER_ID, role: 'PLATFORM_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: TARGET_COMPANY_ID, userId: TARGET_OWNER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: OTHER_BUYER_COMPANY_ID, userId: OTHER_BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  legacyAdminToken = (await createSession({ userId: LEGACY_ADMIN_USER_ID, activeCompanyId: LEGACY_ADMIN_COMPANY_ID })).token;
  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  targetOwnerToken = (await createSession({ userId: TARGET_OWNER_USER_ID, activeCompanyId: TARGET_COMPANY_ID })).token;
  otherBuyerToken = (await createSession({ userId: OTHER_BUYER_USER_ID, activeCompanyId: OTHER_BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityType: 'Company', entityId: { in: [TARGET_COMPANY_ID, OTHER_BUYER_COMPANY_ID] } } });
  await db.companyMembership.deleteMany({
    where: { companyId: { in: [SUPER_ADMIN_COMPANY_ID, LEGACY_ADMIN_COMPANY_ID, MANAGER_COMPANY_ID, TARGET_COMPANY_ID, OTHER_BUYER_COMPANY_ID] } },
  });
  await db.user.deleteMany({ where: { id: { in: [SUPER_ADMIN_USER_ID, LEGACY_ADMIN_USER_ID, MANAGER_USER_ID, TARGET_OWNER_USER_ID, OTHER_BUYER_USER_ID] } } });
  await db.company.deleteMany({
    where: { id: { in: [SUPER_ADMIN_COMPANY_ID, LEGACY_ADMIN_COMPANY_ID, MANAGER_COMPANY_ID, TARGET_COMPANY_ID, OTHER_BUYER_COMPANY_ID] } },
  });
});

async function resetTargetToActive() {
  await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'ACTIVE' } });
}

describe('POST /api/admin/companies/[companyId]/suspend', () => {
  it('PLATFORM_SUPER_ADMIN can suspend a company', async () => {
    await resetTargetToActive();
    const response = await suspendRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/suspend`, superAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('SUSPENDED');
    expect(body).not.toHaveProperty('passwordHash');

    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_COMPANY_SUSPENDED', entityId: TARGET_COMPANY_ID } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(SUPER_ADMIN_USER_ID);
  });

  it('legacy PLATFORM_ADMIN can suspend a company too', async () => {
    await resetTargetToActive();
    const response = await suspendRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/suspend`, legacyAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
  });

  it('PLATFORM_MANAGER cannot suspend a company', async () => {
    await resetTargetToActive();
    const response = await suspendRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/suspend`, managerToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(403);
    const company = await db.company.findUnique({ where: { id: TARGET_COMPANY_ID } });
    expect(company?.status).toBe('ACTIVE');
  });

  it('an ordinary company user cannot suspend any company, including their own', async () => {
    await resetTargetToActive();
    const response = await suspendRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/suspend`, targetOwnerToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await suspendRoute(
      new NextRequest(`http://localhost/api/admin/companies/${TARGET_COMPANY_ID}/suspend`, {
        method: 'POST',
        headers: new Headers({ origin: 'http://localhost' }),
      }),
      { params: Promise.resolve({ companyId: TARGET_COMPANY_ID }) },
    );
    expect(response.status).toBe(401);
  });

  it('suspending an already-suspended company returns a conflict, not a silent success', async () => {
    await resetTargetToActive();
    const first = await suspendRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/suspend`, superAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(first.status).toBe(200);
    const second = await suspendRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/suspend`, superAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(second.status).toBe(409);
  });

  it('returns 404 for a company that does not exist', async () => {
    const response = await suspendRoute(postReq('/api/admin/companies/does-not-exist/suspend', superAdminToken), {
      params: Promise.resolve({ companyId: 'does-not-exist' }),
    });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/admin/companies/[companyId]/activate', () => {
  it('PLATFORM_SUPER_ADMIN can activate a suspended company', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await activateRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/activate`, superAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ACTIVE');

    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_COMPANY_ACTIVATED', entityId: TARGET_COMPANY_ID } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(SUPER_ADMIN_USER_ID);
  });

  it('legacy PLATFORM_ADMIN can activate a company too', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await activateRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/activate`, legacyAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
  });

  it('PLATFORM_MANAGER cannot activate a company', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await activateRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/activate`, managerToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(403);
    const company = await db.company.findUnique({ where: { id: TARGET_COMPANY_ID } });
    expect(company?.status).toBe('SUSPENDED');
  });

  it('activating an already-active company returns a conflict', async () => {
    await resetTargetToActive();
    const response = await activateRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/activate`, superAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(409);
  });
});

describe('suspended-company enforcement on ordinary transactional routes', () => {
  it('an active company\'s own user can access their own transactional data normally', async () => {
    await resetTargetToActive();
    const response = await purchaseOrdersRoute(
      getReq(`/api/companies/${TARGET_COMPANY_ID}/purchase-orders`, targetOwnerToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: TARGET_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
  });

  it('once suspended, that same user is denied with a clear 403 - never a client-bypassable failure', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await purchaseOrdersRoute(
      getReq(`/api/companies/${TARGET_COMPANY_ID}/purchase-orders`, targetOwnerToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: TARGET_COMPANY_ID }) },
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/suspended/i);
  });

  it('reactivating restores normal transactional access for that company\'s users', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'ACTIVE' } });
    const response = await purchaseOrdersRoute(
      getReq(`/api/companies/${TARGET_COMPANY_ID}/purchase-orders`, targetOwnerToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: TARGET_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
  });

  it('a platform administrator can still administer a suspended company (view its members) - suspension never blocks platform staff', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await companyMembersRoute(
      getReq(`/api/admin/companies/${TARGET_COMPANY_ID}/members`, superAdminToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: TARGET_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
    await resetTargetToActive();
  });

  it('a platform administrator can still reactivate a suspended company (suspension does not lock the admin out of the fix)', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await activateRoute(postReq(`/api/admin/companies/${TARGET_COMPANY_ID}/activate`, superAdminToken), {
      params: Promise.resolve({ companyId: TARGET_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
  });

  it('suspending one company never affects another, unrelated company\'s access', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await purchaseOrdersRoute(
      getReq(`/api/companies/${OTHER_BUYER_COMPANY_ID}/purchase-orders`, otherBuyerToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: OTHER_BUYER_COMPANY_ID }) },
    );
    expect(response.status).toBe(200);
    await resetTargetToActive();
  });

  it('cross-company access remains blocked regardless of suspension state - a company\'s suspension is not a way in to another tenant\'s data', async () => {
    await db.company.update({ where: { id: TARGET_COMPANY_ID }, data: { status: 'SUSPENDED' } });
    const response = await purchaseOrdersRoute(
      getReq(`/api/companies/${TARGET_COMPANY_ID}/purchase-orders`, otherBuyerToken) as unknown as NextRequest,
      { params: Promise.resolve({ companyId: TARGET_COMPANY_ID }) },
    );
    // Same generic 404 an IDOR probe against any non-owned company would get (see
    // requireCompanyAccess's own comment) - the caller's own company is active, so this is the
    // ordinary tenant-mismatch path, not the suspended-company path.
    expect(response.status).toBe(404);
    await resetTargetToActive();
  });
});
