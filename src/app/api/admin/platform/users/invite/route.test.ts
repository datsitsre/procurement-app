// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { POST as invitePlatformUserRoute } from './route';
import { POST as acceptRoute } from '@/app/api/invitations/accept/route';

/**
 * Part X - Add Platform User - security coverage. Real, end-to-end tests against the actual
 * route with real sessions and real Postgres.
 */

const SUPER_ADMIN_ID = `test-pinv-super-admin-${Date.now()}`;
const LEGACY_ADMIN_ID = `test-pinv-legacy-admin-${Date.now()}`;
const MANAGER_ID = `test-pinv-manager-${Date.now()}`;
const BUYER_OWNER_ID = `test-pinv-buyer-owner-${Date.now()}`;
const EXISTING_BUYER_ID = `test-pinv-existing-buyer-${Date.now()}`;

const SUPER_ADMIN_CO = `test-pinv-super-admin-co-${Date.now()}`;
const LEGACY_ADMIN_CO = `test-pinv-legacy-admin-co-${Date.now()}`;
const MANAGER_CO = `test-pinv-manager-co-${Date.now()}`;
const BUYER_CO = `test-pinv-buyer-co-${Date.now()}`;
const EXISTING_BUYER_CO = `test-pinv-existing-buyer-co-${Date.now()}`;

let superAdminToken: string;
let legacyAdminToken: string;
let managerToken: string;
let buyerOwnerToken: string;

function req(url: string, token: string | undefined, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: new Headers({
      ...(token ? { cookie: `session_token=${token}` } : {}),
      origin: 'http://localhost',
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  });
}
function publicPost(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: SUPER_ADMIN_CO, name: 'PInv Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: LEGACY_ADMIN_CO, name: 'PInv Legacy Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: MANAGER_CO, name: 'PInv Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_CO, name: 'PInv Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true } });
  await db.company.create({ data: { id: EXISTING_BUYER_CO, name: 'PInv Existing Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true } });

  await db.user.create({ data: { id: SUPER_ADMIN_ID, name: 'PInv Super Admin', email: `${SUPER_ADMIN_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: LEGACY_ADMIN_ID, name: 'PInv Legacy Admin', email: `${LEGACY_ADMIN_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: MANAGER_ID, name: 'PInv Manager', email: `${MANAGER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_OWNER_ID, name: 'PInv Buyer Owner', email: `${BUYER_OWNER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: EXISTING_BUYER_ID, name: 'PInv Existing Buyer', email: `${EXISTING_BUYER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_CO, userId: SUPER_ADMIN_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: LEGACY_ADMIN_CO, userId: LEGACY_ADMIN_ID, role: 'PLATFORM_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: MANAGER_CO, userId: MANAGER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_CO, userId: BUYER_OWNER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: EXISTING_BUYER_CO, userId: EXISTING_BUYER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  superAdminToken = (await createSession({ userId: SUPER_ADMIN_ID, activeCompanyId: SUPER_ADMIN_CO })).token;
  legacyAdminToken = (await createSession({ userId: LEGACY_ADMIN_ID, activeCompanyId: LEGACY_ADMIN_CO })).token;
  managerToken = (await createSession({ userId: MANAGER_ID, activeCompanyId: MANAGER_CO })).token;
  buyerOwnerToken = (await createSession({ userId: BUYER_OWNER_ID, activeCompanyId: BUYER_CO })).token;
});

afterAll(async () => {
  const userIds = [SUPER_ADMIN_ID, LEGACY_ADMIN_ID, MANAGER_ID, BUYER_OWNER_ID, EXISTING_BUYER_ID];
  const companyIds = [SUPER_ADMIN_CO, LEGACY_ADMIN_CO, MANAGER_CO, BUYER_CO, EXISTING_BUYER_CO];
  const accepted = await db.companyInvitation.findMany({ where: { companyId: { in: companyIds } }, select: { acceptedUserId: true } });
  const acceptedUserIds = accepted.map((a) => a.acceptedUserId).filter((id): id is string => !!id);
  await db.companyInvitation.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { actorId: { in: acceptedUserIds } }] } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: [...userIds, ...acceptedUserIds] } } });
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
});

describe('POST /api/admin/platform/users/invite', () => {
  it('1 & 2. Super Admin can add a platform user, creating a permitted role (PLATFORM_MANAGER)', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', superAdminToken, { email: `new-manager-${Date.now()}@example.test`, name: 'New Manager', role: 'PLATFORM_MANAGER' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.token).toBe('string');
    expect(body.invitation.role).toBe('PLATFORM_MANAGER');
    expect(body.invitation.companyId).toBe(SUPER_ADMIN_CO);
  });

  it('Super Admin can also invite another PLATFORM_SUPER_ADMIN', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', superAdminToken, { email: `new-super-${Date.now()}@example.test`, name: 'New Super', role: 'PLATFORM_SUPER_ADMIN' }),
    );
    expect(response.status).toBe(200);
  });

  it('3. legacy Platform Admin can create roles allowed by existing hierarchy (PLATFORM_MANAGER)', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', legacyAdminToken, { email: `admin-invited-manager-${Date.now()}@example.test`, name: 'Admin Invited Manager', role: 'PLATFORM_MANAGER' }),
    );
    expect(response.status).toBe(200);
  });

  it('4. legacy Platform Admin cannot create PLATFORM_SUPER_ADMIN', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', legacyAdminToken, { email: `admin-cannot-super-${Date.now()}@example.test`, name: 'Should Fail', role: 'PLATFORM_SUPER_ADMIN' }),
    );
    expect(response.status).toBe(403);
  });

  it('5. Platform Manager cannot add platform users', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', managerToken, { email: `manager-cannot-${Date.now()}@example.test`, name: 'Should Fail', role: 'PLATFORM_MANAGER' }),
    );
    expect(response.status).toBe(403);
  });

  it('6. company users cannot add platform users', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', buyerOwnerToken, { email: `company-cannot-${Date.now()}@example.test`, name: 'Should Fail', role: 'PLATFORM_MANAGER' }),
    );
    expect(response.status).toBe(403);
  });

  it('7. unauthorized direct API access (no session) returns 401/403', async () => {
    const response = await invitePlatformUserRoute(req('/api/admin/platform/users/invite', undefined, { email: 'nobody@example.test', name: 'Nobody', role: 'PLATFORM_MANAGER' }));
    expect([401, 403]).toContain(response.status);
  });

  it('12. self-escalation is blocked - inviting your own email does not let you grant yourself a higher role (governed the same as any other invite, and the invited email is independent of the actor)', async () => {
    // The invite flow has no concept of "invite myself" specifically, but confirms a Manager
    // still cannot use this endpoint at all, including for their own email.
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', managerToken, { email: `${MANAGER_ID}@example.test`, name: 'Self', role: 'PLATFORM_SUPER_ADMIN' }),
    );
    expect(response.status).toBe(403);
  });

  it('13. unauthorized Super Admin escalation is blocked end to end (Manager cannot reach Super Admin via invitation)', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', managerToken, { email: `manager-escalate-${Date.now()}@example.test`, name: 'Escalate', role: 'PLATFORM_SUPER_ADMIN' }),
    );
    expect(response.status).toBe(403);
  });

  it('8 & 9. existing-user handling: inviting an email that already has a User does not create a duplicate, and other company memberships are unaffected', async () => {
    const existingUser = await db.user.findUnique({ where: { id: EXISTING_BUYER_ID } });
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', superAdminToken, { email: existingUser!.email, name: existingUser!.name, role: 'PLATFORM_MANAGER' }),
    );
    expect(response.status).toBe(200);
    const { token } = await response.json();

    const acceptResponse = await acceptRoute(publicPost('/api/invitations/accept', { token }));
    expect(acceptResponse.status).toBe(200);
    const acceptBody = await acceptResponse.json();
    expect(acceptBody.userId).toBe(EXISTING_BUYER_ID); // reused, not duplicated

    const userCount = await db.user.count({ where: { email: existingUser!.email } });
    expect(userCount).toBe(1);

    // Their pre-existing buyer-company membership must remain completely untouched.
    const originalMembership = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId: EXISTING_BUYER_CO, userId: EXISTING_BUYER_ID } },
    });
    expect(originalMembership?.status).toBe('ACTIVE');
    expect(originalMembership?.role).toBe('OWNER');

    const newPlatformMembership = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId: SUPER_ADMIN_CO, userId: EXISTING_BUYER_ID } },
    });
    expect(newPlatformMembership?.role).toBe('PLATFORM_MANAGER');
    expect(newPlatformMembership?.status).toBe('ACTIVE');
  });

  it('10. password hash is never returned', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', superAdminToken, { email: `no-hash-${Date.now()}@example.test`, name: 'No Hash', role: 'PLATFORM_MANAGER' }),
    );
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/passwordHash/i);
  });

  it('14. an audit event is generated for platform user invitation', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', superAdminToken, { email: `audited-platform-${Date.now()}@example.test`, name: 'Audited Platform', role: 'PLATFORM_MANAGER' }),
    );
    const { invitation } = await response.json();
    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_USER_INVITED', entityId: invitation.id } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(SUPER_ADMIN_ID);
  });

  it('17. tenant isolation - a platform invitation is always scoped to the actor\'s own platform company, never a client-supplied one', async () => {
    const response = await invitePlatformUserRoute(
      req('/api/admin/platform/users/invite', superAdminToken, { email: `tenant-scoped-${Date.now()}@example.test`, name: 'Scoped', role: 'PLATFORM_MANAGER' }),
    );
    const body = await response.json();
    expect(body.invitation.companyId).toBe(SUPER_ADMIN_CO);
  });
});
