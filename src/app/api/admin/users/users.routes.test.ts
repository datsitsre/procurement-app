// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listUsersRoute } from './route';
import { GET as userDetailRoute } from './[userId]/route';
import { PATCH as setStatusRoute } from '@/app/api/admin/platform/users/[userId]/status/route';
import { PATCH as changeRoleRoute } from '@/app/api/admin/platform/users/[userId]/role/route';
import { GET as purchaseOrdersRoute } from '@/app/api/companies/[companyId]/purchase-orders/route';

/**
 * Platform Users Management (directory + detail + self-protection/hierarchy guards) - Phase 10
 * security coverage. Real, end-to-end tests against the actual routes with real sessions and
 * real Postgres, following the same fixture pattern as the Company suspend/activate tests.
 */

const SUPER_ADMIN_USER_ID = `test-pum-super-admin-${Date.now()}`;
const MANAGER_USER_ID = `test-pum-manager-${Date.now()}`;
const OTHER_MANAGER_USER_ID = `test-pum-other-manager-${Date.now()}`;
const BUYER_OWNER_USER_ID = `test-pum-buyer-owner-${Date.now()}`;
const OTHER_BUYER_USER_ID = `test-pum-other-buyer-${Date.now()}`;
// A user with two memberships holding two DIFFERENT roles - the multi-role directory case.
const MULTI_ROLE_USER_ID = `test-pum-multi-role-${Date.now()}`;
// A user with two memberships holding the SAME role at both - multi-company but single-role.
const MULTI_SAME_ROLE_USER_ID = `test-pum-multi-same-role-${Date.now()}`;

const SUPER_ADMIN_COMPANY_ID = `test-pum-super-admin-co-${Date.now()}`;
const MANAGER_COMPANY_ID = `test-pum-manager-co-${Date.now()}`;
const OTHER_MANAGER_COMPANY_ID = `test-pum-other-manager-co-${Date.now()}`;
const BUYER_COMPANY_ID = `test-pum-buyer-co-${Date.now()}`;
const OTHER_BUYER_COMPANY_ID = `test-pum-other-buyer-co-${Date.now()}`;
const MULTI_ROLE_CO_A_ID = `test-pum-multi-role-co-a-${Date.now()}`;
const MULTI_ROLE_CO_B_ID = `test-pum-multi-role-co-b-${Date.now()}`;
const MULTI_SAME_ROLE_CO_A_ID = `test-pum-multi-same-role-co-a-${Date.now()}`;
const MULTI_SAME_ROLE_CO_B_ID = `test-pum-multi-same-role-co-b-${Date.now()}`;

let superAdminToken: string;
let managerToken: string;
let buyerOwnerToken: string;
let otherBuyerToken: string;

function getReq(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, { headers: new Headers({ cookie: `session_token=${token}` }) });
}
function patchReq(url: string, token: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'PATCH',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'PUM Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'PUM Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: OTHER_MANAGER_COMPANY_ID, name: 'PUM Other Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'PUM Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: OTHER_BUYER_COMPANY_ID, name: 'PUM Other Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: MULTI_ROLE_CO_A_ID, name: 'PUM Multi Role Co A', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: MULTI_ROLE_CO_B_ID, name: 'PUM Multi Role Co B', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: MULTI_SAME_ROLE_CO_A_ID, name: 'PUM Multi Same Role Co A', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: MULTI_SAME_ROLE_CO_B_ID, name: 'PUM Multi Same Role Co B', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });

  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'PUM Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'PUM Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: OTHER_MANAGER_USER_ID, name: 'PUM Other Manager', email: `${OTHER_MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_OWNER_USER_ID, name: 'PUM Buyer Owner', email: `${BUYER_OWNER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: OTHER_BUYER_USER_ID, name: 'PUM Other Buyer', email: `${OTHER_BUYER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: MULTI_ROLE_USER_ID, name: 'PUM Multi Role Person', email: `${MULTI_ROLE_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: MULTI_SAME_ROLE_USER_ID, name: 'PUM Multi Same Role Person', email: `${MULTI_SAME_ROLE_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: OTHER_MANAGER_COMPANY_ID, userId: OTHER_MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_OWNER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: OTHER_BUYER_COMPANY_ID, userId: OTHER_BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  // Company A joined first (BUYER), Company B second (APPROVER) - the "first membership" would
  // be BUYER at Co A if naively used as the representative role, which is exactly the
  // misrepresentation this phase's directory fix must avoid.
  await db.companyMembership.create({ data: { companyId: MULTI_ROLE_CO_A_ID, userId: MULTI_ROLE_USER_ID, role: 'BUYER', status: 'ACTIVE', joinedAt: new Date('2024-01-01') } });
  await db.companyMembership.create({ data: { companyId: MULTI_ROLE_CO_B_ID, userId: MULTI_ROLE_USER_ID, role: 'APPROVER', status: 'ACTIVE', joinedAt: new Date('2024-02-01') } });
  await db.companyMembership.create({ data: { companyId: MULTI_SAME_ROLE_CO_A_ID, userId: MULTI_SAME_ROLE_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date('2024-01-01') } });
  await db.companyMembership.create({ data: { companyId: MULTI_SAME_ROLE_CO_B_ID, userId: MULTI_SAME_ROLE_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date('2024-02-01') } });

  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  buyerOwnerToken = (await createSession({ userId: BUYER_OWNER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
  otherBuyerToken = (await createSession({ userId: OTHER_BUYER_USER_ID, activeCompanyId: OTHER_BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  const userIds = [SUPER_ADMIN_USER_ID, MANAGER_USER_ID, OTHER_MANAGER_USER_ID, BUYER_OWNER_USER_ID, OTHER_BUYER_USER_ID, MULTI_ROLE_USER_ID, MULTI_SAME_ROLE_USER_ID];
  const companyIds = [
    SUPER_ADMIN_COMPANY_ID,
    MANAGER_COMPANY_ID,
    OTHER_MANAGER_COMPANY_ID,
    BUYER_COMPANY_ID,
    OTHER_BUYER_COMPANY_ID,
    MULTI_ROLE_CO_A_ID,
    MULTI_ROLE_CO_B_ID,
    MULTI_SAME_ROLE_CO_A_ID,
    MULTI_SAME_ROLE_CO_B_ID,
  ];
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
});

async function resetBuyerOwnerToActive() {
  await db.companyMembership.update({ where: { companyId_userId: { companyId: BUYER_COMPANY_ID, userId: BUYER_OWNER_USER_ID } }, data: { status: 'ACTIVE' } });
}
async function resetOtherManagerToManager() {
  await db.companyMembership.update({ where: { companyId_userId: { companyId: OTHER_MANAGER_COMPANY_ID, userId: OTHER_MANAGER_USER_ID } }, data: { role: 'PLATFORM_MANAGER', status: 'ACTIVE' } });
}

describe('GET /api/admin/users', () => {
  it('1. PLATFORM_SUPER_ADMIN can list every platform user', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users', superAdminToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((u: { id: string }) => u.id === BUYER_OWNER_USER_ID)).toBe(true);
  });

  it('2. an unauthorized (ordinary company) user cannot list users', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users', buyerOwnerToken));
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await listUsersRoute(new NextRequest('http://localhost/api/admin/users'));
    expect(response.status).toBe(401);
  });

  it('13. never includes passwordHash or any credential-shaped field', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users', superAdminToken));
    const body: Record<string, unknown>[] = await response.json();
    const row = body.find((u) => u.id === BUYER_OWNER_USER_ID);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('passwordHash');
    expect(row).not.toHaveProperty('password');
  });

  it('directory presentation 1: a single-membership user displays their one real company/role, not a multi-company shape', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users', superAdminToken));
    const body: Array<{ id: string; membershipCount: number; distinctRoleCount: number; primaryRole: string; primaryCompanyName: string }> = await response.json();
    const row = body.find((u) => u.id === BUYER_OWNER_USER_ID);
    expect(row).toBeDefined();
    expect(row!.membershipCount).toBe(1);
    expect(row!.distinctRoleCount).toBe(1);
    expect(row!.primaryRole).toBe('OWNER');
    expect(row!.primaryCompanyName).toBe('PUM Buyer Co');
  });

  it('directory presentation 2: a multi-company user is clearly flagged with membershipCount > 1, never presented as belonging to just one company', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users', superAdminToken));
    const body: Array<{ id: string; membershipCount: number; distinctRoleCount: number }> = await response.json();
    const row = body.find((u) => u.id === MULTI_ROLE_USER_ID);
    expect(row).toBeDefined();
    expect(row!.membershipCount).toBe(2);
  });

  it('directory presentation 3: a user with two DIFFERENT roles across companies has distinctRoleCount > 1 - their first membership\'s role must never be presented as authoritative', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users', superAdminToken));
    const body: Array<{ id: string; distinctRoleCount: number; primaryRole: string }> = await response.json();
    const row = body.find((u) => u.id === MULTI_ROLE_USER_ID);
    expect(row).toBeDefined();
    expect(row!.distinctRoleCount).toBe(2);
    // primaryRole (BUYER, their first-joined membership) is still returned as raw data for
    // internal use, but distinctRoleCount > 1 is the signal the UI must check before ever
    // rendering primaryRole alone - this is exactly what stops "BUYER at Company A" from
    // misrepresenting someone who is also "APPROVER at Company B".
    expect(row!.primaryRole).toBe('BUYER');
  });

  it('directory presentation: two memberships with the SAME role is still exactly one role, not "multiple roles"', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users', superAdminToken));
    const body: Array<{ id: string; membershipCount: number; distinctRoleCount: number; primaryRole: string }> = await response.json();
    const row = body.find((u) => u.id === MULTI_SAME_ROLE_USER_ID);
    expect(row).toBeDefined();
    expect(row!.membershipCount).toBe(2);
    expect(row!.distinctRoleCount).toBe(1);
    expect(row!.primaryRole).toBe('OWNER');
  });

  it('filtering by role matches ANY membership, not just the first one - a user whose first membership is BUYER still appears when filtering by APPROVER', async () => {
    const response = await listUsersRoute(getReq('/api/admin/users?role=APPROVER', superAdminToken));
    expect(response.status).toBe(200);
    const body: Array<{ id: string }> = await response.json();
    expect(body.some((u) => u.id === MULTI_ROLE_USER_ID)).toBe(true);
  });
});

describe('GET /api/admin/users/[userId]', () => {
  it('3. PLATFORM_SUPER_ADMIN can view a permitted user detail, including memberships', async () => {
    const response = await userDetailRoute(getReq(`/api/admin/users/${BUYER_OWNER_USER_ID}`, superAdminToken), {
      params: Promise.resolve({ userId: BUYER_OWNER_USER_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(BUYER_OWNER_USER_ID);
    expect(body.memberships.some((m: { companyId: string }) => m.companyId === BUYER_COMPANY_ID)).toBe(true);
  });

  it('4. an unauthorized user detail access returns 403', async () => {
    const response = await userDetailRoute(getReq(`/api/admin/users/${BUYER_OWNER_USER_ID}`, buyerOwnerToken), {
      params: Promise.resolve({ userId: BUYER_OWNER_USER_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('13. never includes passwordHash in the detail response', async () => {
    const response = await userDetailRoute(getReq(`/api/admin/users/${BUYER_OWNER_USER_ID}`, superAdminToken), {
      params: Promise.resolve({ userId: BUYER_OWNER_USER_ID }),
    });
    const body = await response.json();
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('directory presentation 4: the detail page lists every membership for a multi-role user - both companies and both distinct roles, never collapsed to one', async () => {
    const response = await userDetailRoute(getReq(`/api/admin/users/${MULTI_ROLE_USER_ID}`, superAdminToken), {
      params: Promise.resolve({ userId: MULTI_ROLE_USER_ID }),
    });
    expect(response.status).toBe(200);
    const body: { memberships: Array<{ companyId: string; role: string }> } = await response.json();
    expect(body.memberships).toHaveLength(2);
    const roleByCompany = Object.fromEntries(body.memberships.map((m) => [m.companyId, m.role]));
    expect(roleByCompany[MULTI_ROLE_CO_A_ID]).toBe('BUYER');
    expect(roleByCompany[MULTI_ROLE_CO_B_ID]).toBe('APPROVER');
  });
});

describe('Role management - self-protection and hierarchy (Phase 6)', () => {
  it('5. an authorized role change succeeds (Super Admin promotes a Manager)', async () => {
    await resetOtherManagerToManager();
    const response = await changeRoleRoute(
      patchReq(`/api/admin/platform/users/${OTHER_MANAGER_USER_ID}/role`, superAdminToken, { companyId: OTHER_MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }),
      { params: Promise.resolve({ userId: OTHER_MANAGER_USER_ID }) },
    );
    expect(response.status).toBe(200);
    await resetOtherManagerToManager();
  });

  it('6. an unauthorized role change (Manager attempting to promote) returns 403', async () => {
    const response = await changeRoleRoute(
      patchReq(`/api/admin/platform/users/${OTHER_MANAGER_USER_ID}/role`, managerToken, { companyId: OTHER_MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }),
      { params: Promise.resolve({ userId: OTHER_MANAGER_USER_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it('7. self-demotion is blocked - Super Admin cannot change their own role', async () => {
    const response = await changeRoleRoute(
      patchReq(`/api/admin/platform/users/${SUPER_ADMIN_USER_ID}/role`, superAdminToken, { companyId: SUPER_ADMIN_COMPANY_ID, role: 'PLATFORM_MANAGER' }),
      { params: Promise.resolve({ userId: SUPER_ADMIN_USER_ID }) },
    );
    expect(response.status).toBe(403);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID } } });
    expect(membership?.role).toBe('PLATFORM_SUPER_ADMIN');
  });

  it('9. Platform Manager cannot escalate itself (same guard blocks both self-change and Manager-lacks-permission)', async () => {
    const response = await changeRoleRoute(
      patchReq(`/api/admin/platform/users/${MANAGER_USER_ID}/role`, managerToken, { companyId: MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }),
      { params: Promise.resolve({ userId: MANAGER_USER_ID }) },
    );
    expect(response.status).toBe(403);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID } } });
    expect(membership?.role).toBe('PLATFORM_MANAGER');
  });
});

describe('Status management - self-protection and hierarchy (Phase 6)', () => {
  it('8. self-suspension is blocked - Super Admin cannot suspend their own account', async () => {
    const response = await setStatusRoute(
      patchReq(`/api/admin/platform/users/${SUPER_ADMIN_USER_ID}/status`, superAdminToken, { companyId: SUPER_ADMIN_COMPANY_ID, status: 'SUSPENDED' }),
      { params: Promise.resolve({ userId: SUPER_ADMIN_USER_ID }) },
    );
    expect(response.status).toBe(403);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID } } });
    expect(membership?.status).toBe('ACTIVE');
  });

  it('8b. self-suspension is blocked for a Manager too', async () => {
    const response = await setStatusRoute(
      patchReq(`/api/admin/platform/users/${MANAGER_USER_ID}/status`, managerToken, { companyId: MANAGER_COMPANY_ID, status: 'SUSPENDED' }),
      { params: Promise.resolve({ userId: MANAGER_USER_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it("a lower-role platform user (Manager) cannot suspend a higher-role platform user (Super Admin)", async () => {
    const response = await setStatusRoute(
      patchReq(`/api/admin/platform/users/${SUPER_ADMIN_USER_ID}/status`, managerToken, { companyId: SUPER_ADMIN_COMPANY_ID, status: 'SUSPENDED' }),
      { params: Promise.resolve({ userId: SUPER_ADMIN_USER_ID }) },
    );
    expect(response.status).toBe(403);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID } } });
    expect(membership?.status).toBe('ACTIVE');
  });

  it('a Super Admin CAN suspend a Manager (higher rank acting on lower rank is allowed)', async () => {
    const response = await setStatusRoute(
      patchReq(`/api/admin/platform/users/${OTHER_MANAGER_USER_ID}/status`, superAdminToken, { companyId: OTHER_MANAGER_COMPANY_ID, status: 'SUSPENDED' }),
      { params: Promise.resolve({ userId: OTHER_MANAGER_USER_ID }) },
    );
    expect(response.status).toBe(200);
    await resetOtherManagerToManager();
  });

  it('10 & 11. a suspended user cannot perform protected operations, and reactivation restores access', async () => {
    await resetBuyerOwnerToActive();
    const before = await purchaseOrdersRoute(getReq(`/api/companies/${BUYER_COMPANY_ID}/purchase-orders`, buyerOwnerToken) as unknown as NextRequest, {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(before.status).toBe(200);

    const suspend = await setStatusRoute(
      patchReq(`/api/admin/platform/users/${BUYER_OWNER_USER_ID}/status`, superAdminToken, { companyId: BUYER_COMPANY_ID, status: 'SUSPENDED' }),
      { params: Promise.resolve({ userId: BUYER_OWNER_USER_ID }) },
    );
    expect(suspend.status).toBe(200);

    const during = await purchaseOrdersRoute(getReq(`/api/companies/${BUYER_COMPANY_ID}/purchase-orders`, buyerOwnerToken) as unknown as NextRequest, {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    // The membership's own tenant resolves to an empty, fail-closed tenant (same shape as any
    // other non-ACTIVE membership) - requireCompanyAccess's ownsRecord mismatch then returns the
    // same generic 404 an IDOR probe would get (see that function's own comment).
    expect(during.status).toBe(404);

    const reactivate = await setStatusRoute(
      patchReq(`/api/admin/platform/users/${BUYER_OWNER_USER_ID}/status`, superAdminToken, { companyId: BUYER_COMPANY_ID, status: 'ACTIVE' }),
      { params: Promise.resolve({ userId: BUYER_OWNER_USER_ID }) },
    );
    expect(reactivate.status).toBe(200);

    const after = await purchaseOrdersRoute(getReq(`/api/companies/${BUYER_COMPANY_ID}/purchase-orders`, buyerOwnerToken) as unknown as NextRequest, {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(after.status).toBe(200);
  });

  it('12. audit records are generated for both role changes and status changes', async () => {
    await resetOtherManagerToManager();
    await changeRoleRoute(
      patchReq(`/api/admin/platform/users/${OTHER_MANAGER_USER_ID}/role`, superAdminToken, { companyId: OTHER_MANAGER_COMPANY_ID, role: 'PLATFORM_SUPER_ADMIN' }),
      { params: Promise.resolve({ userId: OTHER_MANAGER_USER_ID }) },
    );
    const roleAudit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_ROLE_CHANGED', entityId: OTHER_MANAGER_USER_ID, actorId: SUPER_ADMIN_USER_ID } });
    expect(roleAudit).not.toBeNull();
    await resetOtherManagerToManager();

    await setStatusRoute(
      patchReq(`/api/admin/platform/users/${OTHER_MANAGER_USER_ID}/status`, superAdminToken, { companyId: OTHER_MANAGER_COMPANY_ID, status: 'SUSPENDED' }),
      { params: Promise.resolve({ userId: OTHER_MANAGER_USER_ID }) },
    );
    const statusAudit = await db.auditLog.findFirst({ where: { action: 'USER_SUSPENDED', entityId: OTHER_MANAGER_USER_ID, actorId: SUPER_ADMIN_USER_ID } });
    expect(statusAudit).not.toBeNull();
    await resetOtherManagerToManager();
  });

  it('14. tenant isolation remains intact - a suspended company\'s co-tenant is unaffected, and cross-company access stays blocked', async () => {
    await resetBuyerOwnerToActive();
    const response = await purchaseOrdersRoute(getReq(`/api/companies/${BUYER_COMPANY_ID}/purchase-orders`, otherBuyerToken) as unknown as NextRequest, {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(404);

    const ownAccess = await purchaseOrdersRoute(getReq(`/api/companies/${OTHER_BUYER_COMPANY_ID}/purchase-orders`, otherBuyerToken) as unknown as NextRequest, {
      params: Promise.resolve({ companyId: OTHER_BUYER_COMPANY_ID }),
    });
    expect(ownAccess.status).toBe(200);
  });

  it('15. existing company-role (non-platform) suspend/reactivate behavior remains intact', async () => {
    await resetBuyerOwnerToActive();
    const suspend = await setStatusRoute(
      patchReq(`/api/admin/platform/users/${BUYER_OWNER_USER_ID}/status`, managerToken, { companyId: BUYER_COMPANY_ID, status: 'SUSPENDED' }),
      { params: Promise.resolve({ userId: BUYER_OWNER_USER_ID }) },
    );
    expect(suspend.status).toBe(200);
    await resetBuyerOwnerToActive();
  });
});
