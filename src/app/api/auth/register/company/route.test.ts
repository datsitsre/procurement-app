// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { POST as registerCompanyRoute } from './route';

/**
 * PUBLIC COMPANY REGISTRATION PAGE phase - real, end-to-end tests against the actual route and
 * the real database, the same shape as route.test.ts's own coverage for
 * POST /api/admin/companies and POST /api/auth/register.
 */

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];

function registrationBody(overrides: Partial<Record<string, unknown>> = {}) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { administrator, ...rest } = overrides;
  return {
    name: `Test Registrant Co ${unique}`,
    legalName: `Test Registrant Co ${unique} Ltd.`,
    registrationNumber: `REG-${unique}`,
    companyType: 'LIMITED_LIABILITY',
    email: `company-${unique}@example.test`,
    phone: '+233 30 123 4567',
    website: 'https://example.test',
    businessRole: 'BUYER',
    addressLine1: '1 Test Street',
    country: 'GH',
    currency: 'GHS',
    creditTerms: 'NET_30',
    bankName: 'Test Bank',
    bankAccountName: `Test Registrant Co ${unique} Ltd.`,
    bankAccountNumber: '1234567890',
    administrator: {
      name: 'Test Registrant',
      email: `admin-${unique}@example.test`,
      phone: '+233 20 999 0000',
      role: 'OWNER',
      password: 'a-strong-password-99',
      ...(administrator as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

// A distinct x-forwarded-for per call - this route is rate-limited per IP (10 requests / 15 min,
// the same 'auth' bucket POST /api/auth/register already uses), and this file legitimately sends
// far more than 10 requests. Real distinct visitors would have distinct IPs; giving each call its
// own avoids tripping a limit meant for repeated attempts from a single client, without weakening
// or bypassing the limit itself.
let ipCounter = 0;
function postReq(body: unknown) {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/auth/register/company', {
    method: 'POST',
    headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ipCounter}` }),
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityType: 'Company', entityId: { in: createdCompanyIds } } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
  await db.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe('Login -> Create an account navigation (1)', () => {
  it('points at /register/company, not the old plain /register flow or the Super Admin dialog', () => {
    // No React rendering harness exists anywhere in this repo (every existing test is a route or
    // service test against real Postgres) - a lightweight source check is the proportionate way
    // to guard this specific regression without introducing a new testing paradigm for one link.
    const source = readFileSync(new URL('../../../../login/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('href="/register/company"');
    expect(source).not.toContain('href="/register"');
  });
});

describe('Public registration page (2)', () => {
  it('exists as its own route, distinct from /register and /admin/companies', () => {
    const source = readFileSync(new URL('../../../../register/company/page.tsx', import.meta.url), 'utf8');
    expect(source).toContain('export default function RegisterCompanyPage');
  });
});

describe('POST /api/auth/register/company', () => {
  it('(3) unauthenticated visitors can submit a registration - no session/cookie required', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody()));
    expect(response.status).toBe(200);
    const body = await response.json();
    createdCompanyIds.push(...(await db.company.findMany({ where: { name: body.company.name }, select: { id: true } })).map((c) => c.id));
  });

  it('(4) required fields are enforced - missing legalName is rejected before any database write', async () => {
    const payload = registrationBody() as Record<string, unknown>;
    delete payload.legalName;
    const response = await registerCompanyRoute(postReq(payload));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.fieldErrors.legalName).toBeTruthy();
  });

  it('(5) Buyer sets isBuyer/isSupplier correctly', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody({ businessRole: 'BUYER' })));
    const body = await response.json();
    const company = await db.company.findFirstOrThrow({ where: { name: body.company.name } });
    createdCompanyIds.push(company.id);
    expect(company.isBuyer).toBe(true);
    expect(company.isSupplier).toBe(false);
  });

  it('(6) Supplier sets isBuyer/isSupplier correctly', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody({ businessRole: 'SUPPLIER' })));
    const body = await response.json();
    const company = await db.company.findFirstOrThrow({ where: { name: body.company.name } });
    createdCompanyIds.push(company.id);
    expect(company.isBuyer).toBe(false);
    expect(company.isSupplier).toBe(true);
  });

  it('(7) Buyer + Supplier sets both flags true', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody({ businessRole: 'BUYER_AND_SUPPLIER' })));
    const body = await response.json();
    const company = await db.company.findFirstOrThrow({ where: { name: body.company.name } });
    createdCompanyIds.push(company.id);
    expect(company.isBuyer).toBe(true);
    expect(company.isSupplier).toBe(true);
  });

  it('(8, 17) platform/supplier roles cannot be assigned to the initial administrator - the schema has no such value', async () => {
    for (const role of ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_MANAGER', 'SUPPLIER_ADMIN', 'SUPPLIER_STAFF']) {
      const response = await registerCompanyRoute(postReq(registrationBody({ administrator: { role } })));
      expect(response.status).toBe(422);
    }
  });

  it('(9) initial administrator defaults to OWNER when role is omitted', async () => {
    const payload = registrationBody() as { administrator: Record<string, unknown> };
    delete payload.administrator.role;
    const response = await registerCompanyRoute(postReq(payload));
    const body = await response.json();
    const membership = await db.companyMembership.findFirstOrThrow({ where: { company: { name: body.company.name } } });
    createdCompanyIds.push(membership.companyId);
    expect(membership.role).toBe('OWNER');
  });

  it('(10) ADMIN may be explicitly selected as the initial administrator role', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody({ administrator: { role: 'ADMIN' } })));
    const body = await response.json();
    const membership = await db.companyMembership.findFirstOrThrow({ where: { company: { name: body.company.name } } });
    createdCompanyIds.push(membership.companyId);
    expect(membership.role).toBe('ADMIN');
  });

  it('(11) registration enters the existing PENDING_APPROVAL lifecycle - never immediately ACTIVE, no session issued', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody()));
    expect(response.headers.getSetCookie?.() ?? []).toHaveLength(0);
    const body = await response.json();
    expect(body.registrationStatus).toBe('PENDING_APPROVAL');
    const membership = await db.companyMembership.findFirstOrThrow({ where: { company: { name: body.company.name } } });
    createdCompanyIds.push(membership.companyId);
    expect(membership.status).toBe('PENDING_APPROVAL');
  });

  it('(12) duplicate registration number is rejected safely with 409, not a silent overwrite', async () => {
    const regNumber = `REG-DUP-${Date.now()}`;
    const first = await registerCompanyRoute(postReq(registrationBody({ registrationNumber: regNumber })));
    const firstBody = await first.json();
    const firstCompany = await db.company.findFirstOrThrow({ where: { name: firstBody.company.name } });
    createdCompanyIds.push(firstCompany.id);

    const second = await registerCompanyRoute(postReq(registrationBody({ registrationNumber: regNumber })));
    expect(second.status).toBe(409);
  });

  describe('SECURITY HARDENING - existing-account registration is refused, never reused', () => {
    it('(1, 2) a brand-new email can register - creates the expected User, Company, and PENDING_APPROVAL membership', async () => {
      const payload = registrationBody();
      const response = await registerCompanyRoute(postReq(payload));
      expect(response.status).toBe(200);
      const body = await response.json();

      const user = await db.user.findUniqueOrThrow({ where: { email: payload.administrator.email.toLowerCase() } });
      createdUserIds.push(user.id);
      const membership = await db.companyMembership.findFirstOrThrow({ where: { userId: user.id } });
      createdCompanyIds.push(membership.companyId);
      const company = await db.company.findUniqueOrThrow({ where: { id: membership.companyId } });

      expect(company.name).toBe(payload.name);
      expect(membership.status).toBe('PENDING_APPROVAL');
      expect(membership.role).toBe('OWNER');
      expect(body.registrationStatus).toBe('PENDING_APPROVAL');
    });

    it('(3, 4, 5, 6) an existing email creates no new membership and leaves the existing account, its password, and its other memberships untouched', async () => {
      const sharedEmail = `shared-admin-${Date.now()}@example.test`;

      const first = await registerCompanyRoute(postReq(registrationBody({ administrator: { email: sharedEmail } })));
      const firstBody = await first.json();
      const firstMembership = await db.companyMembership.findFirstOrThrow({ where: { company: { name: firstBody.company.name } } });
      createdCompanyIds.push(firstMembership.companyId);
      const user = await db.user.findUniqueOrThrow({ where: { email: sharedEmail } });
      createdUserIds.push(user.id);
      const passwordHashBefore = user.passwordHash;
      const membershipCountBefore = await db.companyMembership.count({ where: { userId: user.id } });

      const second = await registerCompanyRoute(
        postReq(registrationBody({ name: 'A Second Anonymous Attempt Co', administrator: { email: sharedEmail, password: 'a-totally-different-pw' } })),
      );

      // (3) No new company membership was created for this attempt.
      expect(second.status).toBe(409);
      const secondBody = await second.json();
      expect(secondBody.code).toBe('ACCOUNT_EXISTS');
      const attemptedCompany = await db.company.findFirst({ where: { name: 'A Second Anonymous Attempt Co' } });
      expect(attemptedCompany).toBeNull();

      // (4) The existing User row is completely untouched (same name, same row).
      const userAfter = await db.user.findUniqueOrThrow({ where: { email: sharedEmail } });
      expect(userAfter.id).toBe(user.id);
      expect(userAfter.name).toBe(user.name);

      // (5) The password hash was never overwritten, despite a different password being submitted.
      expect(userAfter.passwordHash).toBe(passwordHashBefore);

      // (6) No new membership was attached - the existing membership count is unchanged, and the
      // original (first) registration's own membership is untouched.
      const membershipCountAfter = await db.companyMembership.count({ where: { userId: user.id } });
      expect(membershipCountAfter).toBe(membershipCountBefore);
      const firstMembershipAfter = await db.companyMembership.findUniqueOrThrow({ where: { id: firstMembership.id } });
      expect(firstMembershipAfter.status).toBe('PENDING_APPROVAL');
      expect(firstMembershipAfter.companyId).toBe(firstMembership.companyId);
    });

    it('(7, 8) the ACCOUNT_EXISTS response never leaks passwordHash or any other company membership', async () => {
      const sharedEmail = `shared-admin-leak-check-${Date.now()}@example.test`;
      await registerCompanyRoute(postReq(registrationBody({ administrator: { email: sharedEmail } })));
      const user = await db.user.findUniqueOrThrow({ where: { email: sharedEmail } });
      createdUserIds.push(user.id);
      const membership = await db.companyMembership.findFirstOrThrow({ where: { userId: user.id } });
      createdCompanyIds.push(membership.companyId);

      const response = await registerCompanyRoute(postReq(registrationBody({ administrator: { email: sharedEmail } })));
      expect(response.status).toBe(409);
      const body = await response.json();
      const raw = JSON.stringify(body);
      expect(raw).not.toMatch(/passwordHash/i);
      expect(raw).not.toMatch(new RegExp(user.passwordHash));
      expect(raw).not.toMatch(new RegExp(membership.companyId));
      expect(raw).not.toMatch(/OWNER|ADMIN/); // no role information about the existing account
      expect(raw).not.toMatch(/ACTIVE|SUSPENDED|PENDING_APPROVAL|REJECTED/); // no status of the existing account/membership
    });
  });

  it('(15) password hashes are never returned in the response', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody()));
    const body = await response.json();
    createdCompanyIds.push((await db.company.findFirstOrThrow({ where: { name: body.company.name } })).id);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash/i);
    expect(JSON.stringify(body)).not.toMatch(/a-strong-password-99/);
  });

  it('(16) banking data is never returned in the response or written to the audit log', async () => {
    const response = await registerCompanyRoute(postReq(registrationBody({ bankAccountNumber: '9988776655' })));
    const body = await response.json();
    const company = await db.company.findFirstOrThrow({ where: { name: body.company.name } });
    createdCompanyIds.push(company.id);

    expect(JSON.stringify(body)).not.toMatch(/9988776655/);
    expect(company.bankAccountNumber).toBe('9988776655'); // stored, but never surfaced

    const audit = await db.auditLog.findFirst({ where: { action: 'COMPANY_SELF_REGISTERED', entityId: company.id } });
    expect(JSON.stringify(audit)).not.toMatch(/9988776655/);
  });

  it('(18) a successful registration reports the company name, registered email, and pending status', async () => {
    const payload = registrationBody();
    const response = await registerCompanyRoute(postReq(payload));
    const body = await response.json();
    createdCompanyIds.push((await db.company.findFirstOrThrow({ where: { name: body.company.name } })).id);
    expect(body.company.name).toBe(payload.name);
    expect(body.company.registeredEmail).toBe(payload.administrator.email.toLowerCase());
    expect(body.registrationStatus).toBe('PENDING_APPROVAL');
    expect(typeof body.message).toBe('string');
  });
});
