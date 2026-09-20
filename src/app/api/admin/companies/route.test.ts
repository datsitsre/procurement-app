// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as adminCompaniesRoute } from './route';

/**
 * Phase 26 follow-up - /admin/companies previously read from a frontend-only localStorage mock
 * instead of a real backend endpoint. These are real, end-to-end tests against the actual route
 * with real sessions and real Postgres - the same shape as platformRoles.routes.test.ts's own
 * coverage for /api/orders, /api/payments, etc.
 */

const MANAGER_USER_ID = `test-admin-companies-manager-${Date.now()}`;
const SUPER_ADMIN_USER_ID = `test-admin-companies-super-admin-${Date.now()}`;
const LEGACY_ADMIN_USER_ID = `test-admin-companies-legacy-admin-${Date.now()}`;
const BUYER_USER_ID = `test-admin-companies-buyer-${Date.now()}`;

const MANAGER_COMPANY_ID = `test-admin-companies-manager-co-${Date.now()}`;
const SUPER_ADMIN_COMPANY_ID = `test-admin-companies-super-admin-co-${Date.now()}`;
const LEGACY_ADMIN_COMPANY_ID = `test-admin-companies-legacy-admin-co-${Date.now()}`;
const BUYER_COMPANY_ID = `test-admin-companies-buyer-co-${Date.now()}`;
// A platform-type company (isBuyer: false, isSupplier: false), the same shape as the real
// Platform Headquarters row - proves the directory never lists platform-type companies as if
// they were ordinary buyer customers.
const PLATFORM_TYPE_COMPANY_ID = `test-admin-companies-platform-type-co-${Date.now()}`;
// A supplier-only company - proves the directory never lists suppliers either.
const SUPPLIER_TYPE_COMPANY_ID = `test-admin-companies-supplier-type-co-${Date.now()}`;

let managerToken: string;
let superAdminToken: string;
let legacyAdminToken: string;
let buyerToken: string;

function req(token: string) {
  return new NextRequest('http://localhost/api/admin/companies', { headers: new Headers({ cookie: `session_token=${token}` }) });
}

beforeAll(async () => {
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'Test Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'Test Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: LEGACY_ADMIN_COMPANY_ID, name: 'Test Legacy Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Test Real Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false, creditTerms: 'NET_30' } });
  await db.company.create({ data: { id: PLATFORM_TYPE_COMPANY_ID, name: 'Test Platform HQ Lookalike', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: SUPPLIER_TYPE_COMPANY_ID, name: 'Test Supplier Only Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: true } });

  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'Test Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'Test Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: LEGACY_ADMIN_USER_ID, name: 'Test Legacy Admin', email: `${LEGACY_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_USER_ID, name: 'Test Buyer', email: `${BUYER_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: LEGACY_ADMIN_COMPANY_ID, userId: LEGACY_ADMIN_USER_ID, role: 'PLATFORM_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  legacyAdminToken = (await createSession({ userId: LEGACY_ADMIN_USER_ID, activeCompanyId: LEGACY_ADMIN_COMPANY_ID })).token;
  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityType: 'Company', entityId: 'LIST', actorId: { in: [SUPER_ADMIN_USER_ID, LEGACY_ADMIN_USER_ID] } } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, LEGACY_ADMIN_COMPANY_ID, BUYER_COMPANY_ID] } } });
  await db.user.deleteMany({ where: { id: { in: [MANAGER_USER_ID, SUPER_ADMIN_USER_ID, LEGACY_ADMIN_USER_ID, BUYER_USER_ID] } } });
  await db.company.deleteMany({
    where: { id: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, LEGACY_ADMIN_COMPANY_ID, BUYER_COMPANY_ID, PLATFORM_TYPE_COMPANY_ID, SUPPLIER_TYPE_COMPANY_ID] } } },
  );
});

describe('GET /api/admin/companies', () => {
  it('PLATFORM_SUPER_ADMIN can access the company list', async () => {
    const response = await adminCompaniesRoute(req(superAdminToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((c: { id: string }) => c.id === BUYER_COMPANY_ID)).toBe(true);
  });

  it('legacy PLATFORM_ADMIN can access it too - permission-equivalent to PLATFORM_SUPER_ADMIN', async () => {
    const response = await adminCompaniesRoute(req(legacyAdminToken));
    expect(response.status).toBe(200);
  });

  it('PLATFORM_MANAGER is denied - this endpoint is cross-company business data, not platform-operations metadata', async () => {
    const response = await adminCompaniesRoute(req(managerToken));
    expect(response.status).toBe(403);
  });

  it('an ordinary company user cannot enumerate other companies through this endpoint', async () => {
    const response = await adminCompaniesRoute(req(buyerToken));
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await adminCompaniesRoute(new NextRequest('http://localhost/api/admin/companies'));
    expect(response.status).toBe(401);
  });

  it('never lists a platform-type or supplier-only company as if it were a buyer company', async () => {
    const response = await adminCompaniesRoute(req(superAdminToken));
    const body: { id: string }[] = await response.json();
    const ids = body.map((c) => c.id);
    expect(ids).not.toContain(PLATFORM_TYPE_COMPANY_ID);
    expect(ids).not.toContain(SUPPLIER_TYPE_COMPANY_ID);
    expect(ids).not.toContain(MANAGER_COMPANY_ID);
    expect(ids).not.toContain(SUPER_ADMIN_COMPANY_ID);
  });

  it('returns only the fields the Companies UI needs - never credit limit, tax id, email, or any other sensitive/unrelated field', async () => {
    const response = await adminCompaniesRoute(req(superAdminToken));
    const body: Record<string, unknown>[] = await response.json();
    const row = body.find((c) => c.id === BUYER_COMPANY_ID);
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual(['country', 'createdAt', 'creditTerms', 'currency', 'id', 'memberCount', 'name'].sort());
    expect(row).not.toHaveProperty('creditLimit');
    expect(row).not.toHaveProperty('creditAvailable');
    expect(row).not.toHaveProperty('taxId');
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('registrationNumber');
    expect((row as { memberCount: number }).memberCount).toBe(1);
  });

  it('records a SUPER_ADMIN_CROSS_COMPANY_READ audit entry for the Super Admin listing every company', async () => {
    await db.auditLog.deleteMany({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST' } });

    const response = await adminCompaniesRoute(req(superAdminToken));
    expect(response.status).toBe(200);

    const entry = await db.auditLog.findFirst({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST', actorId: SUPER_ADMIN_USER_ID } });
    expect(entry).not.toBeNull();
  });

  it('PLATFORM_MANAGER never generates a cross-company-read audit entry, since it is denied before reaching the data', async () => {
    await db.auditLog.deleteMany({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST', actorId: MANAGER_USER_ID } });

    const response = await adminCompaniesRoute(req(managerToken));
    expect(response.status).toBe(403);

    const entry = await db.auditLog.findFirst({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Company', entityId: 'LIST', actorId: MANAGER_USER_ID } });
    expect(entry).toBeNull();
  });
});
