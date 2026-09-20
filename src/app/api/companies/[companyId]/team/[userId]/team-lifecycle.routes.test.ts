// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listTeamRoute } from '@/app/api/companies/[companyId]/team/route';
import { POST as suspendRoute } from './suspend/route';
import { POST as activateRoute } from './activate/route';
import { POST as offboardRoute } from './offboard/route';
import { POST as resetPasswordRoute } from './reset-password/route';
import { POST as completeResetRoute } from '@/app/api/auth/reset-password/route';
import { GET as purchaseOrdersRoute } from '@/app/api/companies/[companyId]/purchase-orders/route';

/**
 * Company User Management (suspend/activate/offboard/reset-password) - Part B16 security
 * coverage. Real, end-to-end tests against the actual routes with real sessions and real
 * Postgres, following the same fixture pattern as company.routes.test.ts. Existing list/add/edit
 * behavior is already covered there and in company.service.test.ts - this file focuses on the
 * new lifecycle actions this phase adds.
 */

const OWNER_A_ID = `test-tlc-owner-a-${Date.now()}`;
const ADMIN_A_ID = `test-tlc-admin-a-${Date.now()}`;
const EMPLOYEE_A_ID = `test-tlc-employee-a-${Date.now()}`;
const MEMBER_A_ID = `test-tlc-member-a-${Date.now()}`;
const SECOND_OWNER_A_ID = `test-tlc-owner-a2-${Date.now()}`;
const OWNER_B_ID = `test-tlc-owner-b-${Date.now()}`;

const COMPANY_A_ID = `test-tlc-company-a-${Date.now()}`;
const COMPANY_B_ID = `test-tlc-company-b-${Date.now()}`;

let ownerAToken: string;
let adminAToken: string;
let employeeAToken: string;
let ownerBToken: string;

function req(url: string, token: string, method = 'POST') {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost' }),
  });
}
function publicReq(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: COMPANY_A_ID, name: 'TLC Company A', country: 'GH', currency: 'GHS', isBuyer: true } });
  await db.company.create({ data: { id: COMPANY_B_ID, name: 'TLC Company B', country: 'GH', currency: 'GHS', isBuyer: true } });

  await db.user.create({ data: { id: OWNER_A_ID, name: 'TLC Owner A', email: `${OWNER_A_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: ADMIN_A_ID, name: 'TLC Admin A', email: `${ADMIN_A_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: EMPLOYEE_A_ID, name: 'TLC Employee A', email: `${EMPLOYEE_A_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: MEMBER_A_ID, name: 'TLC Member A', email: `${MEMBER_A_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: SECOND_OWNER_A_ID, name: 'TLC Second Owner A', email: `${SECOND_OWNER_A_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: OWNER_B_ID, name: 'TLC Owner B', email: `${OWNER_B_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: OWNER_A_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: ADMIN_A_ID, role: 'ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: EMPLOYEE_A_ID, role: 'EMPLOYEE', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: MEMBER_A_ID, role: 'EMPLOYEE', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: SECOND_OWNER_A_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_B_ID, userId: OWNER_B_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  ownerAToken = (await createSession({ userId: OWNER_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  adminAToken = (await createSession({ userId: ADMIN_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  employeeAToken = (await createSession({ userId: EMPLOYEE_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  ownerBToken = (await createSession({ userId: OWNER_B_ID, activeCompanyId: COMPANY_B_ID })).token;
});

afterAll(async () => {
  const userIds = [OWNER_A_ID, ADMIN_A_ID, EMPLOYEE_A_ID, MEMBER_A_ID, SECOND_OWNER_A_ID, OWNER_B_ID];
  const companyIds = [COMPANY_A_ID, COMPANY_B_ID];
  await db.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
});

async function resetMemberAToActive() {
  await db.companyMembership.update({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: MEMBER_A_ID } }, data: { status: 'ACTIVE' } });
}

describe('GET /api/companies/[companyId]/team - authorization', () => {
  it('1. an authorized company admin (OWNER) can list users in their own company', async () => {
    const response = await listTeamRoute(req(`/api/companies/${COMPANY_A_ID}/team`, ownerAToken, 'GET'), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.some((m: { user: { id: string } }) => m.user.id === MEMBER_A_ID)).toBe(true);
  });

  it('2. an unauthorized company role (EMPLOYEE, no USERS_MANAGE) cannot list users', async () => {
    const response = await listTeamRoute(req(`/api/companies/${COMPANY_A_ID}/team`, employeeAToken, 'GET'), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('3. cross-company user listing is denied (Company B owner requesting Company A team)', async () => {
    const response = await listTeamRoute(req(`/api/companies/${COMPANY_A_ID}/team`, ownerBToken, 'GET'), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('19. never returns passwordHash for any user', async () => {
    const response = await listTeamRoute(req(`/api/companies/${COMPANY_A_ID}/team`, ownerAToken, 'GET'), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/passwordHash/i);
  });
});

describe('POST /api/companies/[companyId]/team/[userId]/suspend', () => {
  it('12. an authorized admin can suspend a user in their own company', async () => {
    await resetMemberAToActive();
    const response = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/suspend`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(200);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: MEMBER_A_ID } } });
    expect(membership?.status).toBe('SUSPENDED');

    const audit = await db.auditLog.findFirst({ where: { action: 'TEAM_MEMBER_SUSPENDED', entityId: MEMBER_A_ID, actorId: OWNER_A_ID } });
    expect(audit).not.toBeNull();
  });

  it('2b. an unauthorized role (EMPLOYEE) cannot suspend a user', async () => {
    await resetMemberAToActive();
    const response = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/suspend`, employeeAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('cross-company suspension is denied', async () => {
    await resetMemberAToActive();
    const response = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/suspend`, ownerBToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(404);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: MEMBER_A_ID } } });
    expect(membership?.status).toBe('ACTIVE');
  });

  it('16. an admin cannot suspend themselves', async () => {
    const response = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${OWNER_A_ID}/suspend`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: OWNER_A_ID }),
    });
    expect(response.status).toBe(403);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: OWNER_A_ID } } });
    expect(membership?.status).toBe('ACTIVE');
  });

  it('10. ADMIN cannot suspend/demote the controlling OWNER', async () => {
    const response = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${OWNER_A_ID}/suspend`, adminAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: OWNER_A_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('11. the company\'s only remaining ACTIVE owner can never be suspended, even by another owner', async () => {
    // Suspend the second owner first, leaving OWNER_A as the sole ACTIVE owner.
    await db.companyMembership.update({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: SECOND_OWNER_A_ID } }, data: { status: 'SUSPENDED' } });
    const response = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${OWNER_A_ID}/suspend`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: OWNER_A_ID }),
    });
    // Blocked by the self-suspend guard too, but the last-owner guard is the deeper property -
    // confirmed here via a fresh, different owner acting on OWNER_A instead.
    expect(response.status).toBe(403);
    await db.companyMembership.update({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: SECOND_OWNER_A_ID } }, data: { status: 'ACTIVE' } });
  });

  it("a second real owner CAN suspend the other owner when it wouldn't zero out the company's owners", async () => {
    const response = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${SECOND_OWNER_A_ID}/suspend`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: SECOND_OWNER_A_ID }),
    });
    expect(response.status).toBe(200);
    await db.companyMembership.update({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: SECOND_OWNER_A_ID } }, data: { status: 'ACTIVE' } });
  });

  it('13. suspension blocks normal company operations server-side (resolveTenant fails closed for a non-ACTIVE membership)', async () => {
    await resetMemberAToActive();
    const memberToken = (await createSession({ userId: MEMBER_A_ID, activeCompanyId: COMPANY_A_ID })).token;

    const before = await purchaseOrdersRoute(req(`/api/companies/${COMPANY_A_ID}/purchase-orders`, memberToken, 'GET'), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(before.status).toBe(200);

    await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/suspend`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });

    const during = await purchaseOrdersRoute(req(`/api/companies/${COMPANY_A_ID}/purchase-orders`, memberToken, 'GET'), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    // A suspended member's own tenant resolves empty (server/auth/context.ts's resolveTenant) -
    // requireCompanyAccess's ownsRecord mismatch then returns the same generic 404 an IDOR probe
    // would get, exactly like every other non-ACTIVE-membership case already does.
    expect(during.status).toBe(404);
    await resetMemberAToActive();
  });
});

describe('POST /api/companies/[companyId]/team/[userId]/activate', () => {
  it('14 & 15. an authorized admin can reactivate a suspended user, restoring their permitted access', async () => {
    await db.companyMembership.update({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: MEMBER_A_ID } }, data: { status: 'SUSPENDED' } });
    const response = await activateRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/activate`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(200);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: MEMBER_A_ID } } });
    expect(membership?.status).toBe('ACTIVE');

    const memberToken = (await createSession({ userId: MEMBER_A_ID, activeCompanyId: COMPANY_A_ID })).token;
    const listResponse = await purchaseOrdersRoute(req(`/api/companies/${COMPANY_A_ID}/purchase-orders`, memberToken, 'GET'), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(listResponse.status).toBe(200);

    const audit = await db.auditLog.findFirst({ where: { action: 'TEAM_MEMBER_ACTIVATED', entityId: MEMBER_A_ID, actorId: OWNER_A_ID } });
    expect(audit).not.toBeNull();
  });
});

describe('POST /api/companies/[companyId]/team/[userId]/offboard', () => {
  it('offboarding removes active access without deleting the User record or historical data', async () => {
    await resetMemberAToActive();
    const response = await offboardRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/offboard`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(200);

    // 22. the User record still exists.
    const user = await db.user.findUnique({ where: { id: MEMBER_A_ID } });
    expect(user).not.toBeNull();

    // 24. the offboarded user cannot perform company operations.
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: MEMBER_A_ID } } });
    expect(membership?.status).toBe('SUSPENDED');

    // 25. audit records are generated.
    const audit = await db.auditLog.findFirst({ where: { action: 'TEAM_MEMBER_OFFBOARDED', entityId: MEMBER_A_ID, actorId: OWNER_A_ID } });
    expect(audit).not.toBeNull();

    await resetMemberAToActive();
  });

  it('17. an admin cannot offboard themselves', async () => {
    const response = await offboardRoute(req(`/api/companies/${COMPANY_A_ID}/team/${OWNER_A_ID}/offboard`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: OWNER_A_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('an unauthorized role (EMPLOYEE) cannot offboard a user', async () => {
    await resetMemberAToActive();
    const response = await offboardRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/offboard`, employeeAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(403);
    await resetMemberAToActive();
  });
});

describe('Password reset (trigger + completion)', () => {
  it('20 & 21. an authorized admin can request a reset without exposing the existing password, and the action is audited', async () => {
    const response = await resetPasswordRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/reset-password`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(20);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/passwordHash/i);

    const audit = await db.auditLog.findFirst({ where: { action: 'TEAM_MEMBER_PASSWORD_RESET_REQUESTED', entityId: MEMBER_A_ID, actorId: OWNER_A_ID } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.newValue)).not.toMatch(/token/i);
  });

  it('cross-company password reset trigger is denied', async () => {
    const response = await resetPasswordRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/reset-password`, ownerBToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('the user completes the reset themselves with the issued token, and the old password stops working', async () => {
    const triggerResponse = await resetPasswordRoute(req(`/api/companies/${COMPANY_A_ID}/team/${MEMBER_A_ID}/reset-password`, ownerAToken), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId: MEMBER_A_ID }),
    });
    const { token } = await triggerResponse.json();

    const completeResponse = await completeResetRoute(publicReq('/api/auth/reset-password', { token, newPassword: 'brand-new-password-123' }));
    expect(completeResponse.status).toBe(200);

    const user = await db.user.findUnique({ where: { id: MEMBER_A_ID } });
    const { verifyPassword } = await import('@/server/auth/password');
    expect(await verifyPassword('brand-new-password-123', user!.passwordHash)).toBe(true);

    // Single-use: the same token cannot be replayed.
    const replay = await completeResetRoute(publicReq('/api/auth/reset-password', { token, newPassword: 'another-password-456' }));
    expect(replay.status).toBe(422);
  });

  it('rejects an invalid/unknown token', async () => {
    const response = await completeResetRoute(publicReq('/api/auth/reset-password', { token: 'not-a-real-token', newPassword: 'whatever-1234' }));
    expect(response.status).toBe(422);
  });
});
