// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as overviewRoute } from './route';

/**
 * Platform Command Center Dashboard - GET /api/admin/overview security coverage. Real,
 * end-to-end tests against the actual route with real sessions and real Postgres, following the
 * same fixture pattern as the other admin route test suites in this app.
 */

const SUPER_ADMIN_USER_ID = `test-overview-super-admin-${Date.now()}`;
const LEGACY_ADMIN_USER_ID = `test-overview-legacy-admin-${Date.now()}`;
const MANAGER_USER_ID = `test-overview-manager-${Date.now()}`;
const BUYER_USER_ID = `test-overview-buyer-${Date.now()}`;
const PENDING_USER_ID = `test-overview-pending-${Date.now()}`;

const SUPER_ADMIN_COMPANY_ID = `test-overview-super-admin-co-${Date.now()}`;
const LEGACY_ADMIN_COMPANY_ID = `test-overview-legacy-admin-co-${Date.now()}`;
const MANAGER_COMPANY_ID = `test-overview-manager-co-${Date.now()}`;
const BUYER_COMPANY_ID = `test-overview-buyer-co-${Date.now()}`;
const PENDING_COMPANY_ID = `test-overview-pending-co-${Date.now()}`;

let superAdminToken: string;
let legacyAdminToken: string;
let managerToken: string;
let buyerToken: string;

function req(token?: string) {
  return new NextRequest('http://localhost/api/admin/overview', {
    headers: token ? new Headers({ cookie: `session_token=${token}` }) : new Headers(),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'Overview Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: LEGACY_ADMIN_COMPANY_ID, name: 'Overview Legacy Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'Overview Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Overview Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: PENDING_COMPANY_ID, name: 'Overview Pending Co', country: 'GH', currency: 'GHS' } });

  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'Overview Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: LEGACY_ADMIN_USER_ID, name: 'Overview Legacy Admin', email: `${LEGACY_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'Overview Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_USER_ID, name: 'Overview Buyer', email: `${BUYER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: PENDING_USER_ID, name: 'Overview Pending Person', email: `${PENDING_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: LEGACY_ADMIN_COMPANY_ID, userId: LEGACY_ADMIN_USER_ID, role: 'PLATFORM_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  // A real pending registration (test 9 - approvals sourced from the existing approval system).
  await db.companyMembership.create({ data: { companyId: PENDING_COMPANY_ID, userId: PENDING_USER_ID, role: 'OWNER', status: 'PENDING_APPROVAL' } });

  // A real audit entry (test 8 - activity sourced from the existing audit system), recorded as a
  // platform action (no companyId) so it's visible to PLATFORM_MANAGER's scoped feed too.
  await db.auditLog.create({
    data: {
      actorId: SUPER_ADMIN_USER_ID,
      actorName: 'Overview Super Admin',
      action: 'PLATFORM_COMPANY_SUSPENDED',
      entityType: 'Company',
      entityId: BUYER_COMPANY_ID,
    },
  });

  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  legacyAdminToken = (await createSession({ userId: LEGACY_ADMIN_USER_ID, activeCompanyId: LEGACY_ADMIN_COMPANY_ID })).token;
  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  const userIds = [SUPER_ADMIN_USER_ID, LEGACY_ADMIN_USER_ID, MANAGER_USER_ID, BUYER_USER_ID, PENDING_USER_ID];
  const companyIds = [SUPER_ADMIN_COMPANY_ID, LEGACY_ADMIN_COMPANY_ID, MANAGER_COMPANY_ID, BUYER_COMPANY_ID, PENDING_COMPANY_ID];
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: companyIds } }] } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: companyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.company.deleteMany({ where: { id: { in: companyIds } } });
});

describe('GET /api/admin/overview', () => {
  it('1. PLATFORM_SUPER_ADMIN receives every permitted section', async () => {
    const response = await overviewRoute(req(superAdminToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.companies).toBeDefined();
    expect(body.suppliers).toBeDefined();
    expect(body.users).toBeDefined();
    expect(body.approvals).toBeDefined();
    expect(body.activity).toBeDefined();
    expect(body.systemStatus.database).toBe('healthy');
    expect(body.systemStatus.api).toBe('healthy');
  });

  it('2. legacy PLATFORM_ADMIN receives the same permitted sections as PLATFORM_SUPER_ADMIN', async () => {
    const response = await overviewRoute(req(legacyAdminToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.companies).toBeDefined();
    expect(body.suppliers).toBeDefined();
    expect(body.users).toBeDefined();
    expect(body.approvals).toBeDefined();
    expect(body.activity).toBeDefined();
  });

  it('3. PLATFORM_MANAGER receives only the platform-management sections it is permitted', async () => {
    const response = await overviewRoute(req(managerToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.suppliers).toBeDefined();
    expect(body.users).toBeDefined();
    expect(body.approvals).toBeDefined();
    expect(body.activity).toBeDefined();
    expect(body.systemStatus).toBeDefined();
  });

  it('4. PLATFORM_MANAGER does not receive company transaction metrics - the "companies" key is absent, not zeroed', async () => {
    const response = await overviewRoute(req(managerToken));
    const body = await response.json();
    expect(body.companies).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body, 'companies')).toBe(false);
  });

  it('5. PLATFORM_MANAGER never receives customer order data - no "orders" field exists anywhere in the response, for any role', async () => {
    const superAdminResponse = await overviewRoute(req(superAdminToken));
    const managerResponse = await overviewRoute(req(managerToken));
    const superAdminBody = await superAdminResponse.json();
    const managerBody = await managerResponse.json();
    expect(managerBody).not.toHaveProperty('orders');
    // Not just permission-filtered - this endpoint never queries or returns order data for
    // ANY role, including Super Admin, because a dashboard overview is not a transaction feed.
    expect(superAdminBody).not.toHaveProperty('orders');
  });

  it('6. PLATFORM_MANAGER never receives payment or dispute data - neither field exists in the response, for any role', async () => {
    const response = await overviewRoute(req(managerToken));
    const body = await response.json();
    expect(body).not.toHaveProperty('payments');
    expect(body).not.toHaveProperty('disputes');
  });

  it('7. an unauthorized (ordinary company) user cannot access the platform overview', async () => {
    const response = await overviewRoute(req(buyerToken));
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await overviewRoute(req());
    expect(response.status).toBe(401);
  });

  it('8. recent activity is sourced from the real AuditLog table (every returned row genuinely exists there), not a second activity system', async () => {
    const response = await overviewRoute(req(superAdminToken));
    const body = await response.json();
    expect(Array.isArray(body.activity)).toBe(true);
    expect(body.activity.length).toBeLessThanOrEqual(8);
    expect(body.activity.length).toBeGreaterThan(0);

    // Every row the dashboard returned is looked up directly in AuditLog and must match exactly -
    // proves this reads the real table live, not a cached/fabricated/second copy. Not a search
    // for our own seeded row (the shared test database has other tests writing audit rows
    // concurrently, so which 8 rows are "most recent" at any instant isn't ours to assert).
    for (const entry of body.activity) {
      const row = await db.auditLog.findUnique({ where: { id: entry.id } });
      expect(row).not.toBeNull();
      expect(row!.action).toBe(entry.action);
      expect(row!.actorName).toBe(entry.actorName);
      expect(row!.entityId).toBe(entry.entityId);
    }

    // Descending timestamp order, as GET /api/audit-log itself returns.
    for (let i = 1; i < body.activity.length; i++) {
      expect(new Date(body.activity[i - 1].timestamp).getTime()).toBeGreaterThanOrEqual(new Date(body.activity[i].timestamp).getTime());
    }
  });

  it("PLATFORM_MANAGER's activity feed is scoped to platform-only entries (companyId: null), matching GET /api/audit-log's own scope rule", async () => {
    const response = await overviewRoute(req(managerToken));
    const body = await response.json();
    expect(Array.isArray(body.activity)).toBe(true);
    // Every entry PLATFORM_MANAGER sees must be a platform action, never a specific company's
    // own transaction/audit trail - this is the actual security property, independent of
    // whether any particular seeded row happens to still be in the top-8 window.
    for (const entry of body.activity) {
      expect(entry.companyId).toBeUndefined();
    }
  });

  it('9. pending approvals are sourced from the real, existing CompanyMembership/registration approval system', async () => {
    const response = await overviewRoute(req(superAdminToken));
    const body = await response.json();
    expect(body.approvals.total).toBeGreaterThanOrEqual(1);
    const item = body.approvals.items.find((i: { userId: string }) => i.userId === PENDING_USER_ID);
    expect(item).toBeDefined();
    expect(item.companyName).toBe('Overview Pending Co');
  });

  it('10. the response never contains passwordHash or any credential-shaped field', async () => {
    const response = await overviewRoute(req(superAdminToken));
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/passwordHash/i);
    expect(serialized).not.toMatch(/"password"/i);
  });

  it('company/supplier/platform-user counts are real database aggregates, not fabricated numbers', async () => {
    const response = await overviewRoute(req(superAdminToken));
    const body = await response.json();
    const [activeCompanies, suspendedCompanies] = await Promise.all([
      db.company.count({ where: { isBuyer: true, status: 'ACTIVE' } }),
      db.company.count({ where: { isBuyer: true, status: 'SUSPENDED' } }),
    ]);
    expect(body.companies.active).toBe(activeCompanies);
    expect(body.companies.suspended).toBe(suspendedCompanies);
    expect(body.companies.total).toBe(activeCompanies + suspendedCompanies);
  });
});
