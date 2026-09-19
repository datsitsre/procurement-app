// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as ordersAdminRoute } from '@/app/api/orders/route';
import { GET as paymentsAdminRoute } from '@/app/api/payments/route';
import { GET as analyticsRoute } from '@/app/api/analytics/route';
import { GET as disputesAdminRoute } from '@/app/api/disputes/route';
import { GET as productsModerationRoute } from '@/app/api/products/moderation/route';
import { GET as auditLogRoute } from '@/app/api/audit-log/route';
import { GET as companyAuditLogRoute } from '@/app/api/companies/[companyId]/audit-log/route';
import { GET as orderByIdRoute } from '@/app/api/orders/[id]/route';

/**
 * Phase 25 - the core, non-negotiable requirement of the platform-role split: PLATFORM_MANAGER
 * runs the platform but never automatically sees a single company's transactions, while
 * PLATFORM_SUPER_ADMIN (and the legacy PLATFORM_ADMIN, kept permission-equivalent for backward
 * compatibility) can. Real API-boundary tests, real sessions, real Postgres - not a unit test of
 * the permission table alone, since the actual security boundary is the route + resolveTenant()
 * behavior together.
 */

const MANAGER_USER_ID = `test-platform-manager-${Date.now()}`;
const SUPER_ADMIN_USER_ID = `test-platform-super-admin-${Date.now()}`;
const MANAGER_COMPANY_ID = `test-platform-manager-co-${Date.now()}`;
const SUPER_ADMIN_COMPANY_ID = `test-platform-super-admin-co-${Date.now()}`;

// A real, separate buyer company - proves PLATFORM_MANAGER's audit view never surfaces this
// company's own entries, and that granting a PLATFORM_MANAGER session never yields transaction
// access to it via tenant-isolation bypass.
const BUYER_COMPANY_ID = `test-platform-roles-buyer-${Date.now()}`;
const BUYER_USER_ID = `test-platform-roles-buyer-user-${Date.now()}`;
// A real order the buyer owns, for the cross-company-read-auditing tests below.
const SUPPLIER_COMPANY_ID = `test-platform-roles-supplier-co-${Date.now()}`;
const SUPPLIER_ID = `test-platform-roles-supplier-${Date.now()}`;
const ORDER_ID = `test-platform-roles-order-${Date.now()}`;

let managerToken: string;
let superAdminToken: string;
let buyerToken: string;

function req(url: string, token: string) {
  return new NextRequest(`http://localhost${url}`, { headers: new Headers({ cookie: `session_token=${token}` }) });
}

beforeAll(async () => {
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'Platform Manager Test Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'Platform Super Admin Test Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Platform Roles Buyer Co', country: 'GH', currency: 'GHS' } });

  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'Test Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'Test Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_USER_ID, name: 'Test Buyer', email: `${BUYER_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  await db.company.create({ data: { id: SUPPLIER_COMPANY_ID, name: 'Platform Roles Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true } });
  await db.supplierProfile.create({
    data: { id: SUPPLIER_ID, companyId: SUPPLIER_COMPANY_ID, name: 'Platform Roles Supplier', slug: `platform-roles-supplier-${Date.now()}`, city: 'Accra', country: 'Ghana', description: '', verification: 'VERIFIED' },
  });
  await db.order.create({
    data: {
      id: ORDER_ID,
      reference: `ORD-PLATFORM-ROLES-${Date.now()}`,
      companyId: BUYER_COMPANY_ID,
      supplierId: SUPPLIER_ID,
      subtotal: 100,
      tax: 12.5,
      deliveryFee: 0,
      total: 112.5,
      status: 'CONFIRMED',
      paymentStatus: 'PENDING',
      deliveryLocation: 'Accra',
    },
  });

  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;

  // One real audit entry with a companyId (a "company transaction"-shaped entry) and one with
  // none (a "platform action"-shaped entry) - proves the audit-log scope filter for real.
  await db.auditLog.create({
    data: { actorId: BUYER_USER_ID, actorName: 'Test Buyer', companyId: BUYER_COMPANY_ID, action: 'TEST_COMPANY_ACTION', entityType: 'Test', entityId: 'x' },
  });
  await db.auditLog.create({
    data: { actorId: SUPER_ADMIN_USER_ID, actorName: 'Test Super Admin', companyId: null, action: 'TEST_PLATFORM_ACTION', entityType: 'Test', entityId: 'y' },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityId: { in: ['x', 'y', ORDER_ID] } } });
  await db.order.deleteMany({ where: { id: ORDER_ID } });
  await db.supplierProfile.deleteMany({ where: { id: SUPPLIER_ID } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, BUYER_COMPANY_ID] } } });
  await db.user.deleteMany({ where: { id: { in: [MANAGER_USER_ID, SUPER_ADMIN_USER_ID, BUYER_USER_ID] } } });
  await db.company.deleteMany({ where: { id: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, BUYER_COMPANY_ID, SUPPLIER_COMPANY_ID] } } });
});

describe('Super Admin cross-company read auditing', () => {
  it('PLATFORM_SUPER_ADMIN reading another company order creates a SUPER_ADMIN_CROSS_COMPANY_READ audit entry', async () => {
    const response = await orderByIdRoute(req(`/api/orders/${ORDER_ID}`, superAdminToken), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(response.status).toBe(200);

    const entry = await db.auditLog.findFirst({
      where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Order', entityId: ORDER_ID },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(SUPER_ADMIN_USER_ID);
    expect(entry?.companyId).toBe(BUYER_COMPANY_ID);
  });

  it('the order-owning buyer reading their own order does NOT create a cross-company-read audit entry', async () => {
    await db.auditLog.deleteMany({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityId: ORDER_ID } });

    const response = await orderByIdRoute(req(`/api/orders/${ORDER_ID}`, buyerToken), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(response.status).toBe(200);

    const entry = await db.auditLog.findFirst({
      where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Order', entityId: ORDER_ID },
    });
    expect(entry).toBeNull();
  });

  it('PLATFORM_MANAGER is denied the order entirely and generates no cross-company-read audit entry', async () => {
    await db.auditLog.deleteMany({ where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityId: ORDER_ID } });

    const response = await orderByIdRoute(req(`/api/orders/${ORDER_ID}`, managerToken), { params: Promise.resolve({ id: ORDER_ID }) });
    expect(response.status).toBe(404);

    const entry = await db.auditLog.findFirst({
      where: { action: 'SUPER_ADMIN_CROSS_COMPANY_READ', entityType: 'Order', entityId: ORDER_ID },
    });
    expect(entry).toBeNull();
  });
});

describe('PLATFORM_MANAGER cannot access company transactions', () => {
  it('is denied GET /api/orders (cross-company order data)', async () => {
    const response = await ordersAdminRoute(req('/api/orders', managerToken));
    expect(response.status).toBe(403);
  });

  it('is denied GET /api/payments (cross-company payment data)', async () => {
    const response = await paymentsAdminRoute(req('/api/payments', managerToken));
    expect(response.status).toBe(403);
  });

  it('is denied GET /api/analytics (cross-company transaction analytics)', async () => {
    const response = await analyticsRoute(req('/api/analytics', managerToken));
    expect(response.status).toBe(403);
  });

  it('is denied GET /api/disputes (cross-company dispute data)', async () => {
    const response = await disputesAdminRoute(req('/api/disputes', managerToken));
    expect(response.status).toBe(403);
  });
});

describe('PLATFORM_MANAGER can perform platform operations', () => {
  it('can view the product moderation queue', async () => {
    const response = await productsModerationRoute(req('/api/products/moderation', managerToken));
    expect(response.status).toBe(200);
  });

  it("can view the audit log, but only sees platform-action entries - never a company's own transaction audit trail", async () => {
    const response = await auditLogRoute(req('/api/audit-log', managerToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    const actions = body.items.map((i: { action: string }) => i.action);
    expect(actions).toContain('TEST_PLATFORM_ACTION');
    expect(actions).not.toContain('TEST_COMPANY_ACTION');
  });
});

describe('PLATFORM_SUPER_ADMIN retains full cross-company access (the exceptional role)', () => {
  it('can access GET /api/orders', async () => {
    const response = await ordersAdminRoute(req('/api/orders', superAdminToken));
    expect(response.status).toBe(200);
  });

  it('can access GET /api/payments', async () => {
    const response = await paymentsAdminRoute(req('/api/payments', superAdminToken));
    expect(response.status).toBe(200);
  });

  it('can access GET /api/analytics', async () => {
    const response = await analyticsRoute(req('/api/analytics', superAdminToken));
    expect(response.status).toBe(200);
  });

  it('sees the unfiltered audit log, including company-transaction entries', async () => {
    const response = await auditLogRoute(req('/api/audit-log', superAdminToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    const actions = body.items.map((i: { action: string }) => i.action);
    expect(actions).toContain('TEST_PLATFORM_ACTION');
    expect(actions).toContain('TEST_COMPANY_ACTION');
  });
});

describe('Company-scoped audit log (tenant isolation, section 28)', () => {
  it("a company owner sees their own company's audit entries", async () => {
    const response = await companyAuditLogRoute(req(`/api/companies/${BUYER_COMPANY_ID}/audit-log`, buyerToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.some((i: { action: string }) => i.action === 'TEST_COMPANY_ACTION')).toBe(true);
  });

  it("refuses a PLATFORM_MANAGER reading a specific company's audit trail through this endpoint - PLATFORM_MANAGER never holds AUDIT_VIEW, a company-role-only permission", async () => {
    const response = await companyAuditLogRoute(req(`/api/companies/${BUYER_COMPANY_ID}/audit-log`, managerToken), {
      params: Promise.resolve({ companyId: BUYER_COMPANY_ID }),
    });
    expect(response.status).toBe(403);
  });

  it("refuses an unrelated company's own owner - 404, not empty results, confirming the tenant check runs, not just a filter", async () => {
    const response = await companyAuditLogRoute(req(`/api/companies/${SUPER_ADMIN_COMPANY_ID}/audit-log`, buyerToken), {
      params: Promise.resolve({ companyId: SUPER_ADMIN_COMPANY_ID }),
    });
    expect(response.status).toBe(404);
  });
});
