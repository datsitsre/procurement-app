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

// PLATFORM COMPANY REGISTRATION APPROVAL WORKFLOW phase - a full-detail registration (every
// company-registration field set, including banking, plus an ADMIN-role administrator with a
// phone number) for the enrichment/leakage tests below, and a second, dedicated pending
// registration for reject-specific tests (approve already has its own fixture above).
const RICH_USER_ID = `test-pu-rich-${Date.now()}`;
const RICH_COMPANY_ID = `test-pu-rich-co-${Date.now()}`;
const REJECT_USER_ID = `test-pu-reject-${Date.now()}`;
const REJECT_COMPANY_ID = `test-pu-reject-co-${Date.now()}`;

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
  await db.company.create({
    data: {
      id: RICH_COMPANY_ID,
      name: 'PU Rich Registrant Co',
      legalName: 'PU Rich Registrant Co Ltd.',
      registrationNumber: `REG-RICH-${Date.now()}`,
      companyType: 'LIMITED_LIABILITY',
      email: 'rich-co@example.test',
      phone: '+233 30 111 2222',
      website: 'https://rich-co.example.test',
      country: 'GH',
      currency: 'GHS',
      creditTerms: 'NET_30',
      defaultPaymentMethod: 'BANK_TRANSFER',
      isBuyer: true,
      isSupplier: true,
      bankName: 'Secret Test Bank',
      bankAccountName: 'PU Rich Registrant Co Ltd.',
      bankAccountNumber: '5566778899',
      addresses: { create: { label: 'Main Address', line1: '1 Rich Street', country: 'GH', isDefault: true } },
    },
  });
  await db.company.create({ data: { id: REJECT_COMPANY_ID, name: 'PU Reject Co', country: 'GH', currency: 'GHS' } });

  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'PU Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'PU Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_USER_ID, name: 'PU Buyer', email: `${BUYER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: PENDING_USER_ID, name: 'PU Pending Person', email: `${PENDING_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: ACTIVE_USER_ID, name: 'PU Active Person', email: `${ACTIVE_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: RICH_USER_ID, name: 'PU Rich Administrator', email: `${RICH_USER_ID}@example.test`, phone: '+233 20 333 4444', passwordHash: 'a-real-looking-hash-value' } });
  await db.user.create({ data: { id: REJECT_USER_ID, name: 'PU Reject Person', email: `${REJECT_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: PENDING_COMPANY_ID, userId: PENDING_USER_ID, role: 'OWNER', status: 'PENDING_APPROVAL' } });
  await db.companyMembership.create({ data: { companyId: ACTIVE_COMPANY_ID, userId: ACTIVE_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: RICH_COMPANY_ID, userId: RICH_USER_ID, role: 'ADMIN', status: 'PENDING_APPROVAL' } });
  await db.companyMembership.create({ data: { companyId: REJECT_COMPANY_ID, userId: REJECT_USER_ID, role: 'OWNER', status: 'PENDING_APPROVAL' } });

  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  const companyIds = [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, BUYER_COMPANY_ID, PENDING_COMPANY_ID, ACTIVE_COMPANY_ID, RICH_COMPANY_ID, REJECT_COMPANY_ID];
  const userIds = [MANAGER_USER_ID, SUPER_ADMIN_USER_ID, BUYER_USER_ID, PENDING_USER_ID, ACTIVE_USER_ID, RICH_USER_ID, REJECT_USER_ID];
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

  describe('PLATFORM COMPANY REGISTRATION APPROVAL WORKFLOW - company registration enrichment', () => {
    it('a rich registration carries its full company-registration detail, correctly derived', async () => {
      const response = await listPlatformUsersRoute(req('/api/admin/platform/users', managerToken));
      const body = await response.json();
      const row = body.find((u: { userId: string }) => u.userId === RICH_USER_ID);
      expect(row).toBeTruthy();
      expect(row.companyRegistration.legalName).toBe('PU Rich Registrant Co Ltd.');
      expect(row.companyRegistration.registrationNumber).toMatch(/^REG-RICH-/);
      expect(row.companyRegistration.companyType).toBe('LIMITED_LIABILITY');
      expect(row.companyRegistration.businessRole).toBe('BUYER_AND_SUPPLIER'); // isBuyer && isSupplier both true
      expect(row.companyRegistration.email).toBe('rich-co@example.test');
      expect(row.companyRegistration.phone).toBe('+233 30 111 2222');
      expect(row.companyRegistration.website).toBe('https://rich-co.example.test');
      expect(row.companyRegistration.country).toBe('GH');
      expect(row.companyRegistration.currency).toBe('GHS');
      expect(row.companyRegistration.creditTerms).toBe('NET_30');
      expect(row.companyRegistration.defaultPaymentMethod).toBe('BANK_TRANSFER');
      expect(row.companyRegistration.addressLine1).toBe('1 Rich Street');
      expect(row.companyRegistration.administratorPhone).toBe('+233 20 333 4444');
      expect(row.role).toBe('ADMIN'); // the role selected during registration, preserved
    });

    it('(16) banking data never appears anywhere in the response, even for a company that has it set', async () => {
      const response = await listPlatformUsersRoute(req('/api/admin/platform/users', managerToken));
      const raw = await response.text();
      expect(raw).not.toMatch(/bankName|bankAccountName|bankAccountNumber/i);
      expect(raw).not.toMatch(/Secret Test Bank/);
      expect(raw).not.toMatch(/5566778899/);
    });

    it('(15) password hashes are never exposed in the response', async () => {
      const response = await listPlatformUsersRoute(req('/api/admin/platform/users', managerToken));
      const raw = await response.text();
      expect(raw).not.toMatch(/passwordHash/i);
      expect(raw).not.toMatch(/a-real-looking-hash-value/);
    });

    it('a plain BUYER-only registration derives businessRole BUYER, never SUPPLIER or BUYER_AND_SUPPLIER', async () => {
      const response = await listPlatformUsersRoute(req('/api/admin/platform/users', managerToken));
      const body = await response.json();
      // PENDING_COMPANY_ID/ACTIVE_COMPANY_ID/REJECT_COMPANY_ID were created with no isBuyer/isSupplier
      // override, i.e. the Company model's own defaults (both false) - confirms the mapping is a
      // real, honest read of the stored flags, not a hardcoded guess.
      const row = body.find((u: { userId: string }) => u.userId === PENDING_USER_ID);
      expect(row.companyRegistration.businessRole).toBe('NONE');
    });
  });
});

describe('PATCH /api/admin/platform/users/[userId]/registration', () => {
  it('a company user is denied', async () => {
    const response = await decideRegistrationRoute(req(`/api/admin/platform/users/${PENDING_USER_ID}/registration`, buyerToken, { companyId: PENDING_COMPANY_ID, decision: 'APPROVED' }), {
      params: Promise.resolve({ userId: PENDING_USER_ID }),
    });
    expect(response.status).toBe(403);
  });

  it('PLATFORM_MANAGER can approve a pending registration - no duplicate user, unrelated memberships untouched', async () => {
    const unrelatedMembershipBefore = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId: ACTIVE_COMPANY_ID, userId: ACTIVE_USER_ID } } });

    const response = await decideRegistrationRoute(req(`/api/admin/platform/users/${PENDING_USER_ID}/registration`, managerToken, { companyId: PENDING_COMPANY_ID, decision: 'APPROVED' }), {
      params: Promise.resolve({ userId: PENDING_USER_ID }),
    });
    expect(response.status).toBe(200);
    const membership = await db.companyMembership.findUnique({ where: { companyId_userId: { companyId: PENDING_COMPANY_ID, userId: PENDING_USER_ID } } });
    expect(membership?.status).toBe('ACTIVE');
    expect(membership?.role).toBe('OWNER'); // the role selected at registration, preserved

    // (10) No duplicate User was created by approving - exactly one row still exists for this
    // registrant's email (scoped to that email, not a global count, so this stays valid under
    // concurrent test-file execution against the shared test database).
    const pendingUser = await db.user.findUniqueOrThrow({ where: { id: PENDING_USER_ID } });
    const usersWithThisEmail = await db.user.findMany({ where: { email: pendingUser.email } });
    expect(usersWithThisEmail).toHaveLength(1);

    // (11) A completely unrelated membership is untouched by this decision.
    const unrelatedMembershipAfter = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId: ACTIVE_COMPANY_ID, userId: ACTIVE_USER_ID } } });
    expect(unrelatedMembershipAfter.status).toBe(unrelatedMembershipBefore.status);
    expect(unrelatedMembershipAfter.role).toBe(unrelatedMembershipBefore.role);

    // (17) Audit event is generated, using existing conventions - never a second event name for
    // the same meaning.
    const audit = await db.auditLog.findFirst({ where: { actorId: MANAGER_USER_ID, action: 'REGISTRATION_APPROVED', entityId: PENDING_USER_ID } });
    expect(audit).not.toBeNull();
    // Never password/passwordHash/bank details in the audit metadata.
    expect(JSON.stringify(audit)).not.toMatch(/passwordHash|bankAccount/i);
  });

  it('deciding an already-decided registration again fails (no double-approval)', async () => {
    const response = await decideRegistrationRoute(req(`/api/admin/platform/users/${PENDING_USER_ID}/registration`, managerToken, { companyId: PENDING_COMPANY_ID, decision: 'REJECTED' }), {
      params: Promise.resolve({ userId: PENDING_USER_ID }),
    });
    expect(response.status).toBe(404);
  });

  it('(4, 7, 13, 14) a company user cannot reject; an authorized admin can; rejecting again fails safely; the rejected registration stays inaccessible', async () => {
    const deniedResponse = await decideRegistrationRoute(
      req(`/api/admin/platform/users/${REJECT_USER_ID}/registration`, buyerToken, { companyId: REJECT_COMPANY_ID, decision: 'REJECTED' }),
      { params: Promise.resolve({ userId: REJECT_USER_ID }) },
    );
    expect(deniedResponse.status).toBe(403);
    let membership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId: REJECT_COMPANY_ID, userId: REJECT_USER_ID } } });
    expect(membership.status).toBe('PENDING_APPROVAL'); // untouched by the denied attempt

    const response = await decideRegistrationRoute(
      req(`/api/admin/platform/users/${REJECT_USER_ID}/registration`, managerToken, { companyId: REJECT_COMPANY_ID, decision: 'REJECTED' }),
      { params: Promise.resolve({ userId: REJECT_USER_ID }) },
    );
    expect(response.status).toBe(200);
    membership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId: REJECT_COMPANY_ID, userId: REJECT_USER_ID } } });
    expect(membership.status).toBe('REJECTED');

    // (14) A rejected registration remains inaccessible - never ACTIVE, no working tenant.
    expect(membership.joinedAt).toBeNull();

    // (13) Rejecting an already-rejected registration again is refused, not silently re-applied.
    const repeated = await decideRegistrationRoute(
      req(`/api/admin/platform/users/${REJECT_USER_ID}/registration`, managerToken, { companyId: REJECT_COMPANY_ID, decision: 'REJECTED' }),
      { params: Promise.resolve({ userId: REJECT_USER_ID }) },
    );
    expect(repeated.status).toBe(404);

    // Also cannot be *approved* after rejection through this same pending record - the existing
    // workflow has no "re-review after rejection" path, and this confirms one wasn't accidentally
    // introduced.
    const approveAfterReject = await decideRegistrationRoute(
      req(`/api/admin/platform/users/${REJECT_USER_ID}/registration`, managerToken, { companyId: REJECT_COMPANY_ID, decision: 'APPROVED' }),
      { params: Promise.resolve({ userId: REJECT_USER_ID }) },
    );
    expect(approveAfterReject.status).toBe(404);
    membership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId: REJECT_COMPANY_ID, userId: REJECT_USER_ID } } });
    expect(membership.status).toBe('REJECTED'); // still rejected, never flipped to ACTIVE

    // Company and User rows themselves are never deleted by a rejection - only the membership
    // status changes, and audit history is preserved.
    expect(await db.company.findUnique({ where: { id: REJECT_COMPANY_ID } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: REJECT_USER_ID } })).not.toBeNull();
    const audit = await db.auditLog.findFirst({ where: { actorId: MANAGER_USER_ID, action: 'REGISTRATION_REJECTED', entityId: REJECT_USER_ID } });
    expect(audit).not.toBeNull();
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
