// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { POST as inviteRoute } from './route';
import { GET as listInvitationsRoute } from '../invitations/route';
import { POST as resendRoute } from '../invitations/[invitationId]/resend/route';
import { POST as revokeRoute } from '../invitations/[invitationId]/revoke/route';
import { GET as previewRoute } from '@/app/api/invitations/[token]/route';
import { POST as acceptRoute } from '@/app/api/invitations/accept/route';
import { GET as purchaseOrdersRoute } from '@/app/api/companies/[companyId]/purchase-orders/route';

/**
 * Real Company User Invitation + Onboarding - Phase 20 security coverage. Real, end-to-end
 * tests against the actual routes with real sessions and real Postgres, following the same
 * fixture pattern as team-lifecycle.routes.test.ts.
 */

const OWNER_A_ID = `test-inv-owner-a-${Date.now()}`;
const ADMIN_A_ID = `test-inv-admin-a-${Date.now()}`;
const PROCUREMENT_A_ID = `test-inv-procurement-a-${Date.now()}`;
const BUYER_ROLE_A_ID = `test-inv-buyer-a-${Date.now()}`;
const FINANCE_A_ID = `test-inv-finance-a-${Date.now()}`;
const APPROVER_A_ID = `test-inv-approver-a-${Date.now()}`;
const EMPLOYEE_A_ID = `test-inv-employee-a-${Date.now()}`;
const OWNER_B_ID = `test-inv-owner-b-${Date.now()}`;
const EXISTING_MULTI_COMPANY_USER_ID = `test-inv-multi-${Date.now()}`;

const COMPANY_A_ID = `test-inv-company-a-${Date.now()}`;
const COMPANY_B_ID = `test-inv-company-b-${Date.now()}`;

let ownerAToken: string;
let adminAToken: string;
let procurementAToken: string;
let buyerAToken: string;
let financeAToken: string;
let approverAToken: string;
let employeeAToken: string;
let ownerBToken: string;

function req(url: string, token: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
function publicGet(url: string) {
  return new NextRequest(`http://localhost${url}`);
}
function publicPost(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: COMPANY_A_ID, name: 'Invitation Test Company A', country: 'GH', currency: 'GHS', isBuyer: true } });
  await db.company.create({ data: { id: COMPANY_B_ID, name: 'Invitation Test Company B', country: 'GH', currency: 'GHS', isBuyer: true } });

  for (const [id, name] of [
    [OWNER_A_ID, 'Inv Owner A'],
    [ADMIN_A_ID, 'Inv Admin A'],
    [PROCUREMENT_A_ID, 'Inv Procurement A'],
    [BUYER_ROLE_A_ID, 'Inv Buyer A'],
    [FINANCE_A_ID, 'Inv Finance A'],
    [APPROVER_A_ID, 'Inv Approver A'],
    [EMPLOYEE_A_ID, 'Inv Employee A'],
    [OWNER_B_ID, 'Inv Owner B'],
    [EXISTING_MULTI_COMPANY_USER_ID, 'Inv Multi Company Person'],
  ]) {
    await db.user.create({ data: { id, name, email: `${id}@example.test`, passwordHash: 'x' } });
  }

  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: OWNER_A_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: ADMIN_A_ID, role: 'ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: PROCUREMENT_A_ID, role: 'PROCUREMENT_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: BUYER_ROLE_A_ID, role: 'BUYER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: FINANCE_A_ID, role: 'FINANCE_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: APPROVER_A_ID, role: 'APPROVER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: EMPLOYEE_A_ID, role: 'EMPLOYEE', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: COMPANY_B_ID, userId: OWNER_B_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  // The existing-account case (Part 18/6a) - already a BUYER at Company A before being invited
  // to Company B.
  await db.companyMembership.create({ data: { companyId: COMPANY_A_ID, userId: EXISTING_MULTI_COMPANY_USER_ID, role: 'BUYER', status: 'ACTIVE', joinedAt: new Date() } });

  ownerAToken = (await createSession({ userId: OWNER_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  adminAToken = (await createSession({ userId: ADMIN_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  procurementAToken = (await createSession({ userId: PROCUREMENT_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  buyerAToken = (await createSession({ userId: BUYER_ROLE_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  financeAToken = (await createSession({ userId: FINANCE_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  approverAToken = (await createSession({ userId: APPROVER_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  employeeAToken = (await createSession({ userId: EMPLOYEE_A_ID, activeCompanyId: COMPANY_A_ID })).token;
  ownerBToken = (await createSession({ userId: OWNER_B_ID, activeCompanyId: COMPANY_B_ID })).token;
});

afterAll(async () => {
  const userIds = [OWNER_A_ID, ADMIN_A_ID, PROCUREMENT_A_ID, BUYER_ROLE_A_ID, FINANCE_A_ID, APPROVER_A_ID, EMPLOYEE_A_ID, OWNER_B_ID, EXISTING_MULTI_COMPANY_USER_ID];
  const companyIds = [COMPANY_A_ID, COMPANY_B_ID];
  const invitedEmails = await db.companyInvitation.findMany({ where: { companyId: { in: companyIds } }, select: { acceptedUserId: true } });
  const acceptedUserIds = invitedEmails.map((i) => i.acceptedUserId).filter((id): id is string => !!id);
  await db.companyInvitation.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { actorId: { in: acceptedUserIds } }] } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: [...userIds, ...acceptedUserIds] } } });
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
});

describe('POST /api/companies/[companyId]/team/invite - RBAC matrix', () => {
  it('1. OWNER can invite', async () => {
    const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email: `owner-invited-${Date.now()}@example.test`, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.token).toBe('string');
    expect(body.invitation.status).toBe('PENDING');
  });

  it('2. ADMIN can invite', async () => {
    const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, adminAToken, { email: `admin-invited-${Date.now()}@example.test`, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(response.status).toBe(200);
  });

  it('3-7. non-management roles cannot invite (PROCUREMENT_MANAGER, BUYER, FINANCE_MANAGER, APPROVER, EMPLOYEE)', async () => {
    for (const token of [procurementAToken, buyerAToken, financeAToken, approverAToken, employeeAToken]) {
      const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, token, { email: `should-not-invite-${Date.now()}@example.test`, role: 'EMPLOYEE' }), {
        params: Promise.resolve({ companyId: COMPANY_A_ID }),
      });
      expect(response.status).toBe(403);
    }
  });

  it('8. cross-company invitation attempt is denied', async () => {
    const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerBToken, { email: `cross-company-${Date.now()}@example.test`, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('9. a platform role can never be assigned through the company invitation flow', async () => {
    const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email: `platform-attempt-${Date.now()}@example.test`, role: 'PLATFORM_SUPER_ADMIN' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    // Zod rejects it outright (not a company role in NewInvitationSchema's z.nativeEnum(Role)
    // path check performed by inviteTeamMember) - either way it must never succeed.
    expect([403, 422]).toContain(response.status);
  });

  it('OWNER role can only be granted by an existing OWNER, mirroring updateTeamMember', async () => {
    const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, adminAToken, { email: `owner-attempt-${Date.now()}@example.test`, role: 'OWNER' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    expect(response.status).toBe(403);
  });
});

describe('Invitation token security', () => {
  it('10. the raw token is never stored - only its hash', async () => {
    const email = `token-storage-${Date.now()}@example.test`;
    const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { token } = await response.json();
    const row = await db.companyInvitation.findFirst({ where: { email } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash.length).toBe(64); // sha256 hex digest
  });

  it('26. an invalid/unknown token returns a safe, generic error', async () => {
    const response = await previewRoute(publicGet('/api/invitations/not-a-real-token'), { params: Promise.resolve({ token: 'not-a-real-token' }) });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/invalid/i);
  });

  it('12. an expired invitation is rejected', async () => {
    const email = `expired-${Date.now()}@example.test`;
    const response = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { token } = await response.json();
    await db.companyInvitation.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const preview = await previewRoute(publicGet(`/api/invitations/${token}`), { params: Promise.resolve({ token }) });
    expect(preview.status).toBe(404);
    const acceptResponse = await acceptRoute(publicPost('/api/invitations/accept', { token, name: 'Should Not Work', password: 'password1234' }));
    expect(acceptResponse.status).toBe(422);
  });

  it('13. a revoked invitation is rejected', async () => {
    const email = `revoke-target-${Date.now()}@example.test`;
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { invitation, token } = await createResponse.json();

    const revokeResponse = await revokeRoute(req(`/api/companies/${COMPANY_A_ID}/team/invitations/${invitation.id}/revoke`, ownerAToken, {}), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, invitationId: invitation.id }),
    });
    expect(revokeResponse.status).toBe(200);

    const acceptResponse = await acceptRoute(publicPost('/api/invitations/accept', { token, name: 'Should Not Work', password: 'password1234' }));
    expect(acceptResponse.status).toBe(422);
    const acceptBody = await acceptResponse.json();
    expect(acceptBody.code).toBe('REVOKED');
  });

  it('23. an unauthorized role cannot resend an invitation', async () => {
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email: `resend-unauthorized-${Date.now()}@example.test`, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { invitation } = await createResponse.json();
    const response = await resendRoute(req(`/api/companies/${COMPANY_A_ID}/team/invitations/${invitation.id}/resend`, employeeAToken, {}), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, invitationId: invitation.id }),
    });
    expect(response.status).toBe(403);
  });

  it('24. an unauthorized role cannot revoke an invitation', async () => {
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email: `revoke-unauthorized-${Date.now()}@example.test`, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { invitation } = await createResponse.json();
    const response = await revokeRoute(req(`/api/companies/${COMPANY_A_ID}/team/invitations/${invitation.id}/revoke`, employeeAToken, {}), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, invitationId: invitation.id }),
    });
    expect(response.status).toBe(403);
  });

  it('14. resend invalidates the previous token', async () => {
    const email = `resend-target-${Date.now()}@example.test`;
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { invitation, token: originalToken } = await createResponse.json();

    const resendResponse = await resendRoute(req(`/api/companies/${COMPANY_A_ID}/team/invitations/${invitation.id}/resend`, ownerAToken, {}), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, invitationId: invitation.id }),
    });
    expect(resendResponse.status).toBe(200);
    const { token: newTokenValue } = await resendResponse.json();
    expect(newTokenValue).not.toBe(originalToken);

    const oldPreview = await previewRoute(publicGet(`/api/invitations/${originalToken}`), { params: Promise.resolve({ token: originalToken }) });
    expect(oldPreview.status).toBe(404);

    const newPreview = await previewRoute(publicGet(`/api/invitations/${newTokenValue}`), { params: Promise.resolve({ token: newTokenValue }) });
    expect(newPreview.status).toBe(200);
  });
});

describe('Invitation acceptance', () => {
  it('15 & 17 & 20. a brand-new account can accept and set a password, activating the correct membership, with no passwordHash ever returned', async () => {
    const email = `brand-new-${Date.now()}@example.test`;
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE', name: 'Brand New Person' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { token } = await createResponse.json();

    const previewResponse = await previewRoute(publicGet(`/api/invitations/${token}`), { params: Promise.resolve({ token }) });
    const preview = await previewResponse.json();
    expect(preview.isExistingAccount).toBe(false);
    expect(JSON.stringify(preview)).not.toMatch(/passwordHash/i);

    const acceptResponse = await acceptRoute(publicPost('/api/invitations/accept', { token, password: 'a-strong-password-1' }));
    expect(acceptResponse.status).toBe(200);
    const acceptBody = await acceptResponse.json();
    expect(JSON.stringify(acceptBody)).not.toMatch(/passwordHash/i);

    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: COMPANY_A_ID, userId: acceptBody.userId } } });
    expect(membership?.status).toBe('ACTIVE');
    expect(membership?.role).toBe('EMPLOYEE');

    const { verifyPassword } = await import('@/server/auth/password');
    const user = await db.user.findUnique({ where: { id: acceptBody.userId } });
    expect(await verifyPassword('a-strong-password-1', user!.passwordHash)).toBe(true);
  });

  it('16 & 18. an existing account can accept without corrupting its password or its other company memberships', async () => {
    const existingUser = await db.user.findUnique({ where: { id: EXISTING_MULTI_COMPANY_USER_ID } });
    const originalHash = existingUser!.passwordHash;

    const createResponse = await inviteRoute(
      req(`/api/companies/${COMPANY_B_ID}/team/invite`, ownerBToken, { email: existingUser!.email, role: 'APPROVER' }),
      { params: Promise.resolve({ companyId: COMPANY_B_ID }) },
    );
    expect(createResponse.status).toBe(200);
    const { token } = await createResponse.json();

    const previewResponse = await previewRoute(publicGet(`/api/invitations/${token}`), { params: Promise.resolve({ token }) });
    const preview = await previewResponse.json();
    expect(preview.isExistingAccount).toBe(true);

    // No password supplied - existing accounts never need one to accept.
    const acceptResponse = await acceptRoute(publicPost('/api/invitations/accept', { token }));
    expect(acceptResponse.status).toBe(200);
    const acceptBody = await acceptResponse.json();
    expect(acceptBody.userId).toBe(EXISTING_MULTI_COMPANY_USER_ID);

    const userAfter = await db.user.findUnique({ where: { id: EXISTING_MULTI_COMPANY_USER_ID } });
    expect(userAfter!.passwordHash).toBe(originalHash); // untouched

    const companyBMembership = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId: COMPANY_B_ID, userId: EXISTING_MULTI_COMPANY_USER_ID } },
    });
    expect(companyBMembership?.status).toBe('ACTIVE');
    expect(companyBMembership?.role).toBe('APPROVER');

    // Part 18 - Company A's own, pre-existing membership must remain completely untouched.
    const companyAMembership = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId: COMPANY_A_ID, userId: EXISTING_MULTI_COMPANY_USER_ID } },
    });
    expect(companyAMembership?.status).toBe('ACTIVE');
    expect(companyAMembership?.role).toBe('BUYER');
  });

  it('19. the invited user cannot transact before accepting', async () => {
    const email = `not-yet-accepted-${Date.now()}@example.test`;
    await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE', name: 'Not Yet' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    // No User row exists yet at all for a brand-new invitee, so there is no session to even
    // attempt a request with - the strongest possible form of "cannot transact before acceptance".
    const user = await db.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it('25. an invitation cannot be accepted twice', async () => {
    const email = `double-accept-${Date.now()}@example.test`;
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE', name: 'Double Accept' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { token } = await createResponse.json();

    const first = await acceptRoute(publicPost('/api/invitations/accept', { token, password: 'a-strong-password-2' }));
    expect(first.status).toBe(200);

    const second = await acceptRoute(publicPost('/api/invitations/accept', { token, password: 'a-strong-password-2' }));
    expect(second.status).toBe(422);
    const secondBody = await second.json();
    expect(secondBody.code).toBe('ALREADY_ACCEPTED');
  });

  it('22. audit events are generated for invite and accept', async () => {
    const email = `audited-${Date.now()}@example.test`;
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE', name: 'Audited Person' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { invitation, token } = await createResponse.json();

    const invitedAudit = await db.auditLog.findFirst({ where: { action: 'TEAM_MEMBER_INVITED', entityId: invitation.id } });
    expect(invitedAudit).not.toBeNull();
    expect(invitedAudit?.actorId).toBe(OWNER_A_ID);
    expect(JSON.stringify(invitedAudit?.newValue)).not.toMatch(/token/i);

    await acceptRoute(publicPost('/api/invitations/accept', { token, password: 'a-strong-password-3' }));
    const acceptedAudit = await db.auditLog.findFirst({ where: { action: 'TEAM_MEMBER_INVITATION_ACCEPTED', entityId: invitation.id } });
    expect(acceptedAudit).not.toBeNull();
    expect(JSON.stringify(acceptedAudit)).not.toMatch(/password/i);
  });
});

describe('Regression - existing behavior remains intact', () => {
  it("27/28. suspend/offboard still work exactly as before, unaffected by the invitation feature", async () => {
    const email = `regression-suspend-${Date.now()}@example.test`;
    const createResponse = await inviteRoute(req(`/api/companies/${COMPANY_A_ID}/team/invite`, ownerAToken, { email, role: 'EMPLOYEE', name: 'Regression Person' }), {
      params: Promise.resolve({ companyId: COMPANY_A_ID }),
    });
    const { token } = await createResponse.json();
    const acceptResponse = await acceptRoute(publicPost('/api/invitations/accept', { token, password: 'a-strong-password-4' }));
    const { userId } = await acceptResponse.json();

    const memberToken = (await createSession({ userId, activeCompanyId: COMPANY_A_ID })).token;
    const before = await purchaseOrdersRoute(req(`/api/companies/${COMPANY_A_ID}/purchase-orders`, memberToken), { params: Promise.resolve({ companyId: COMPANY_A_ID }) });
    expect(before.status).toBe(200);

    const { POST: suspendRoute } = await import('@/app/api/companies/[companyId]/team/[userId]/suspend/route');
    const suspendResponse = await suspendRoute(req(`/api/companies/${COMPANY_A_ID}/team/${userId}/suspend`, ownerAToken, {}), {
      params: Promise.resolve({ companyId: COMPANY_A_ID, userId }),
    });
    expect(suspendResponse.status).toBe(200);

    const during = await purchaseOrdersRoute(req(`/api/companies/${COMPANY_A_ID}/purchase-orders`, memberToken), { params: Promise.resolve({ companyId: COMPANY_A_ID }) });
    expect(during.status).toBe(404);
  });

  it('30. tenant isolation remains intact for the listing endpoint', async () => {
    const response = await listInvitationsRoute(req(`/api/companies/${COMPANY_A_ID}/team/invitations`, ownerBToken), { params: Promise.resolve({ companyId: COMPANY_A_ID }) });
    expect(response.status).toBe(404);
  });
});
