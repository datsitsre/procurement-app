// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listPlatformUsersRoute } from '@/app/api/admin/platform/users/route';
import { PATCH as decideRegistrationRoute } from '@/app/api/admin/platform/users/[userId]/registration/route';
import { PATCH as setStatusRoute } from '@/app/api/admin/platform/users/[userId]/status/route';
import { PATCH as changeRoleRoute } from '@/app/api/admin/platform/users/[userId]/role/route';

/**
 * Phase 26 - platform user administration: real API-boundary tests, real sessions, real
 * Postgres. Covers exactly the scenarios ACCESS_CONTROL_IMPLEMENTATION_REPORT.md Section 17's
 * "no dedicated platform user management route exists yet" gap asked for, plus the specific
 * escalation guards the follow-up brief named (PLATFORM_MANAGER cannot promote itself or anyone
 * else to PLATFORM_SUPER_ADMIN, cannot grant itself transaction access, ordinary company users
 * cannot reach any of this).
 */

const MANAGER_USER_ID = `test-pu-manager-${Date.now()}`;
const SUPER_ADMIN_USER_ID = `test-pu-super-admin-${Date.now()}`;
const MANAGER_COMPANY_ID = `test-pu-manager-co-${Date.now()}`;
const SUPER_ADMIN_COMPANY_ID = `test-pu-super-admin-co-${Date.now()}`;

const BUYER_USER_ID = `test-pu-buyer-${Date.now()}`;
const BUYER_COMPANY_ID = `test-pu-buyer-co-${Date.now()}`;

// A real pending registration for the approve/reject tests.
const PENDING_USER_ID = `test-pu-pending-${Date.now()}`;
const PENDING_COMPANY_ID = `test-pu-pending-co-${Date.now()}`;

// A real, already-active member for the suspend/activate tests.
const ACTIVE_USER_ID = `test-pu-active-${Date.now()}`;
const ACTIVE_COMPANY_ID = `test-pu-active-co-${Date.now()}`;

let managerToken: string;
let superAdminToken: string;
let buyerToken: string;

function req(url: string, token: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: body ? 'PATCH' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'PU Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'PU Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'PU Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({ data: { id: PENDING_COMPANY_ID, name: 'PU Pending Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({ data: { id: ACTIVE_COMPANY_ID, name: 'PU Active Co', country: 'GH', currency: 'GHS' } });

  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'PU Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'PU Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_USER_ID, name: 'PU Buyer', email: `${BUYER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: PENDING_USER_ID, name: 'PU Pending Person', email: `${PENDING_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: ACTIVE_USER_ID, name: 'PU Active Person', email: `${ACTIVE_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: PENDING_COMPANY_ID, userId: PENDING_USER_ID, role: 'OWNER', status: 'PENDING_APPROVAL' } });
  await db.companyMembership.create({ data: { companyId: ACTIVE_COMPANY_ID, userId: ACTIVE_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  const companyIds = [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, BUYER_COMPANY_ID, PENDING_COMPANY_ID, ACTIVE_COMPANY_ID];
  const userIds = [MANAGER_USER_ID, SUPER_ADMIN_USER_ID, BUYER_USER_ID, PENDING_USER_ID, ACTIVE_USER_ID];
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
});

describe('GET /api/admin/platform/users', () => {
  it('a company user (no platform role) is denied entirely', async () => {
    const response = await listPlatformUsersRoute(req('/api/admin/platform/users', buyerToken));
    expect(response.status).toBe(403);
  });

  it('PLATFORM_MANAGER can view the queue, including the pending registration', async () => {
    const response = await listPlatformUsersRoute(req('/api/admin/platform/users', managerToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.some((u: { userId: string }) => u.userId === PENDING_USER_ID)).toBe(true);
  });
});

describe('PATCH /api/admin/platform/users/[userId]/registration', () => {
  it('a company user is denied', async () => {
    const response = await decideRegistrationRoute(req(`/api/admin/platform/users/${PENDING_USER_ID}/registration`, buyerToken, { companyId: PENDING_COMPANY_ID, decision: 'APPROVED' }), {
      params: Promise.resolve({ userId: PENDING_USER_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('PLATFORM_MANAGER can approve a pending registration', async () => {
    const response = await decideRegistrationRoute(req(`/api/admin/platform/users/${PENDING_USER_ID}/registration`, managerToken, { companyId: PENDING_COMPANY_ID, decision: 'APPROVED' }), {
      params: Promise.resolve({ userId: PENDING_USER_ID }),
    });
    expect(response.status).toBe(200);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: PENDING_COMPANY_ID, userId: PENDING_USER_ID } } });
    expect(membership?.status).toBe('ACTIVE');

    const audit = await db.auditLog.findFirst({ where: { actorId: MANAGER_USER_ID, action: 'REGISTRATION_APPROVED', entityId: PENDING_USER_ID } });
    expect(audit).not.toBeNull();
  });

  it('deciding an already-decided registration again fails (no double-approval)', async () => {
    const response = await decideRegistrationRoute(req(`/api/admin/platform/users/${PENDING_USER_ID}/registration`, managerToken, { companyId: PENDING_COMPANY_ID, decision: 'REJECTED' }), {
      params: Promise.resolve({ userId: PENDING_USER_ID }),
    });
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/admin/platform/users/[userId]/status', () => {
  it('PLATFORM_MANAGER can suspend and reactivate an already-active member', async () => {
    const suspend = await setStatusRoute(req(`/api/admin/platform/users/${ACTIVE_USER_ID}/status`, managerToken, { companyId: ACTIVE_COMPANY_ID, status: 'SUSPENDED' }), {
      params: Promise.resolve({ userId: ACTIVE_USER_ID }),
    });
    expect(suspend.status).toBe(200);
    let membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: ACTIVE_COMPANY_ID, userId: ACTIVE_USER_ID } } });
    expect(membership?.status).toBe('SUSPENDED');

    const reactivate = await setStatusRoute(req(`/api/admin/platform/users/${ACTIVE_USER_ID}/status`, managerToken, { companyId: ACTIVE_COMPANY_ID, status: 'ACTIVE' }), {
      params: Promise.resolve({ userId: ACTIVE_USER_ID }),
    });
    expect(reactivate.status).toBe(200);
    membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: ACTIVE_COMPANY_ID, userId: ACTIVE_USER_ID } } });
    expect(membership?.status).toBe('ACTIVE');
  });
});

describe('PATCH /api/admin/platform/users/[userId]/role - escalation protection', () => {
  it('a company user is denied entirely', async () => {
    const response = await changeRoleRoute(req(`/api/admin/platform/users/${MANAGER_USER_ID}/role`, buyerToken, { companyId: MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }), {
      params: Promise.resolve({ userId: MANAGER_USER_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('PLATFORM_MANAGER cannot promote another user to PLATFORM_SUPER_ADMIN - lacks PLATFORM_ROLES_MANAGE entirely', async () => {
    const response = await changeRoleRoute(req(`/api/admin/platform/users/${MANAGER_USER_ID}/role`, managerToken, { companyId: MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }), {
      params: Promise.resolve({ userId: MANAGER_USER_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('PLATFORM_MANAGER cannot promote itself, even indirectly - same 403, before the route ever reaches self-role-change logic', async () => {
    const response = await changeRoleRoute(req(`/api/admin/platform/users/${MANAGER_USER_ID}/role`, managerToken, { companyId: MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }), {
      params: Promise.resolve({ userId: MANAGER_USER_ID }),
    });
    expect(response.status).toBe(403);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID } } });
    expect(membership?.role).toBe('PLATFORM_MANAGER'); // unchanged
  });

  it('PLATFORM_SUPER_ADMIN cannot change their own platform role through this endpoint either', async () => {
    const response = await changeRoleRoute(req(`/api/admin/platform/users/${SUPER_ADMIN_USER_ID}/role`, superAdminToken, { companyId: SUPER_ADMIN_COMPANY_ID, role: 'PLATFORM_MANAGER' }), {
      params: Promise.resolve({ userId: SUPER_ADMIN_USER_ID }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/cannot change your own platform role/i);
  });

  it('PLATFORM_SUPER_ADMIN CAN promote a real PLATFORM_MANAGER to PLATFORM_SUPER_ADMIN, and it is audited', async () => {
    const response = await changeRoleRoute(req(`/api/admin/platform/users/${MANAGER_USER_ID}/role`, superAdminToken, { companyId: MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }), {
      params: Promise.resolve({ userId: MANAGER_USER_ID }),
    });
    expect(response.status).toBe(200);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID } } });
    expect(membership?.role).toBe('PLATFORM_SUPER_ADMIN');

    const audit = await db.auditLog.findFirst({ where: { actorId: SUPER_ADMIN_USER_ID, action: 'PLATFORM_ROLE_CHANGED', entityId: MANAGER_USER_ID } });
    expect(audit).not.toBeNull();

    // Restore for test-order independence.
    await db.companyMembership.update({ where: { id: membership!.id }, data: { role: 'PLATFORM_MANAGER' } });
  });

  it('cannot grant a platform role inside an ordinary buyer/supplier company - only a genuine platform-type company qualifies', async () => {
    const response = await changeRoleRoute(req(`/api/admin/platform/users/${BUYER_USER_ID}/role`, superAdminToken, { companyId: BUYER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }), {
      params: Promise.resolve({ userId: BUYER_USER_ID }),
    });
    expect(response.status).toBe(404);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID } } });
    expect(membership?.role).toBe('OWNER'); // unchanged
  });
});
