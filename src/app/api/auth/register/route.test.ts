// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { POST as registerRoute } from './route';
import { GET as sessionRoute } from '@/app/api/auth/session/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as ordersRoute } from '@/app/api/companies/[companyId]/orders/route';

/**
 * Phase 26 - registration lifecycle. `POST /api/auth/register` now creates the new OWNER
 * membership as PENDING_APPROVAL, not ACTIVE (see the route's own comment for why this reuses
 * resolveTenant/buildSessionPayload's pre-existing "non-ACTIVE = no tenant" behavior rather than
 * inventing a new enforcement mechanism). These are real, end-to-end tests against that route and
 * the real database - not a unit test of the schema enum alone.
 */

const TEST_EMAIL = `test-register-${Date.now()}@example.test`;
const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

function registerRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

afterAll(async () => {
  await db.companyMembership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await db.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await db.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
});

describe('POST /api/auth/register - pending-approval lifecycle', () => {
  it('creates the new membership as PENDING_APPROVAL, not ACTIVE - never automatically elevated', async () => {
    const response = await registerRoute(
      registerRequest({ companyName: 'Register Test Co', country: 'GH', currency: 'GHS', fullName: 'Register Tester', email: TEST_EMAIL, password: 'a-real-password-123' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registrationStatus).toBe('PENDING_APPROVAL');
    expect(body.user.email).toBe(TEST_EMAIL);
    createdUserIds.push(body.user.id);

    const membership = await db.companyMembership.findFirst({ where: { userId: body.user.id } });
    expect(membership).not.toBeNull();
    expect(membership?.status).toBe('PENDING_APPROVAL');
    expect(membership?.role).toBe('OWNER'); // still OWNER of their own new company - just not usable yet
    if (membership) createdCompanyIds.push(membership.companyId);
  });

  it('a pending user gets a session, but it carries no working company/role - cannot access protected functionality', async () => {
    const cookieResponse = await registerRoute(
      registerRequest({ companyName: 'Register Test Co 2', country: 'GH', currency: 'GHS', fullName: 'Pending Tester', email: `pending-${Date.now()}@example.test`, password: 'a-real-password-123' }),
    );
    const setCookie = cookieResponse.headers.getSetCookie?.() ?? [];
    const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    const body = await cookieResponse.json();
    createdUserIds.push(body.user.id);

    const sessionResponse = await sessionRoute(new NextRequest('http://localhost/api/auth/session', { headers: new Headers({ cookie }) }));
    expect(sessionResponse.status).toBe(200);
    const session = await sessionResponse.json();
    // A real session exists (they can see "pending approval" / log out), but no company and no
    // usable role - buildSessionPayload's own ACTIVE-only membership filter (unchanged) already
    // guarantees this.
    expect(session.companies).toEqual([]);
    expect(session.activeCompanyId).toBeNull();

    const pendingMembership = await db.companyMembership.findFirst({ where: { userId: body.user.id } });
    if (pendingMembership) createdCompanyIds.push(pendingMembership.companyId);

    // Cannot reach a protected, company-scoped route with this session - no company was ever
    // resolved for it, so requireCompanyAccess has nothing to match against.
    if (pendingMembership) {
      const ordersResponse = await ordersRoute(
        new NextRequest(`http://localhost/api/companies/${pendingMembership.companyId}/orders`, { headers: new Headers({ cookie }) }),
        { params: Promise.resolve({ companyId: pendingMembership.companyId }) },
      );
      expect(ordersResponse.status).toBe(404);
    }
  });

  it('cannot bypass approval by tampering with the registration request - status/role/companyId are never accepted from the client', async () => {
    // The schema doesn't even have fields for status/role/companyId - RegisterSchema only
    // accepts companyName/country/currency/fullName/email/password, so extra fields are simply
    // ignored by Zod's default (non-strict) parsing, not silently honored.
    const response = await registerRoute(
      registerRequest({
        companyName: 'Tamper Test Co',
        country: 'GH',
        currency: 'GHS',
        fullName: 'Tamper Tester',
        email: `tamper-${Date.now()}@example.test`,
        password: 'a-real-password-123',
        status: 'ACTIVE',
        role: 'PLATFORM_SUPER_ADMIN',
        companyId: 'company-acme-gh',
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    createdUserIds.push(body.user.id);
    expect(body.registrationStatus).toBe('PENDING_APPROVAL');

    const membership = await db.companyMembership.findFirst({ where: { userId: body.user.id } });
    expect(membership?.status).toBe('PENDING_APPROVAL'); // not ACTIVE, despite the tampered field
    expect(membership?.role).toBe('OWNER'); // not PLATFORM_SUPER_ADMIN, despite the tampered field
    if (membership) {
      expect(membership.companyId).not.toBe('company-acme-gh'); // a brand-new company, not the tampered target
      createdCompanyIds.push(membership.companyId);
    }
  });

  it('an approved user can authenticate normally through the real login route afterward', async () => {
    const email = `approved-${Date.now()}@example.test`;
    const registerResponse = await registerRoute(
      registerRequest({ companyName: 'Approved Test Co', country: 'GH', currency: 'GHS', fullName: 'Approved Tester', email, password: 'a-real-password-123' }),
    );
    const body = await registerResponse.json();
    createdUserIds.push(body.user.id);
    const membership = await db.companyMembership.findFirstOrThrow({ where: { userId: body.user.id } });
    createdCompanyIds.push(membership.companyId);

    // Simulate a platform admin's approval directly (the actual approval route is tested in
    // platformUsers.routes.test.ts) - here we only care about the post-approval login behavior.
    await db.companyMembership.update({ where: { id: membership.id }, data: { status: 'ACTIVE', joinedAt: new Date() } });

    const loginResponse = await loginRoute(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'a-real-password-123' }),
        headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
      }),
    );
    expect(loginResponse.status).toBe(200);
    const session = await loginResponse.json();
    expect(session.activeCompanyId).toBe(membership.companyId);
    expect(session.companies).toHaveLength(1);
  });
});
