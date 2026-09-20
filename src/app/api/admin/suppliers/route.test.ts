// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as adminSuppliersRoute, POST as createSupplierRoute } from './route';
import { PATCH as updateSupplierRoute } from './[supplierId]/route';
import { GET as supplierMembersRoute } from './[supplierId]/members/route';

/**
 * Phase 27 - the platform Suppliers management table's real backend. Unlike
 * /api/admin/companies (PLATFORM_TRANSACTIONS_ACCESS, Super Admin/legacy Admin only), this is
 * gated on PLATFORM_CATALOG_MODERATE - supplier onboarding/quality-control data, not a company's
 * transaction data - so PLATFORM_MANAGER is expected to succeed here too, matching
 * /api/suppliers/moderation's own established precedent.
 */

const MANAGER_USER_ID = `test-admin-suppliers-manager-${Date.now()}`;
const SUPER_ADMIN_USER_ID = `test-admin-suppliers-super-admin-${Date.now()}`;
const BUYER_USER_ID = `test-admin-suppliers-buyer-${Date.now()}`;

const MANAGER_COMPANY_ID = `test-admin-suppliers-manager-co-${Date.now()}`;
const SUPER_ADMIN_COMPANY_ID = `test-admin-suppliers-super-admin-co-${Date.now()}`;
const BUYER_COMPANY_ID = `test-admin-suppliers-buyer-co-${Date.now()}`;
const SUPPLIER_COMPANY_ID = `test-admin-suppliers-supplier-co-${Date.now()}`;
const SUPPLIER_ID = `test-admin-suppliers-supplier-${Date.now()}`;

let managerToken: string;
let superAdminToken: string;
let buyerToken: string;

function req(token: string) {
  return new NextRequest('http://localhost/api/admin/suppliers', { headers: new Headers({ cookie: `session_token=${token}` }) });
}

function postReq(token: string, body: unknown) {
  return new NextRequest('http://localhost/api/admin/suppliers', {
    method: 'POST',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

function patchReq(url: string, token: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'PATCH',
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

const createdSupplierIds: string[] = [];
const createdSupplierCompanyIds: string[] = [];

beforeAll(async () => {
  await db.company.create({ data: { id: MANAGER_COMPANY_ID, name: 'Test Manager Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: SUPER_ADMIN_COMPANY_ID, name: 'Test Super Admin Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: false } });
  await db.company.create({ data: { id: BUYER_COMPANY_ID, name: 'Test Buyer Co', country: 'GH', currency: 'GHS', isBuyer: true, isSupplier: false } });
  await db.company.create({ data: { id: SUPPLIER_COMPANY_ID, name: 'Test Real Supplier Co', country: 'GH', currency: 'GHS', isBuyer: false, isSupplier: true } });
  await db.supplierProfile.create({
    data: { id: SUPPLIER_ID, companyId: SUPPLIER_COMPANY_ID, name: 'Test Real Supplier', slug: `test-real-supplier-${Date.now()}`, city: 'Accra', country: 'Ghana', description: '', verification: 'VERIFIED' },
  });

  await db.user.create({ data: { id: MANAGER_USER_ID, name: 'Test Manager', email: `${MANAGER_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: SUPER_ADMIN_USER_ID, name: 'Test Super Admin', email: `${SUPER_ADMIN_USER_ID}@example.test`, passwordHash: 'x' } });
  await db.user.create({ data: { id: BUYER_USER_ID, name: 'Test Buyer', email: `${BUYER_USER_ID}@example.test`, passwordHash: 'x' } });

  await db.companyMembership.create({ data: { companyId: MANAGER_COMPANY_ID, userId: MANAGER_USER_ID, role: 'PLATFORM_MANAGER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: SUPER_ADMIN_COMPANY_ID, userId: SUPER_ADMIN_USER_ID, role: 'PLATFORM_SUPER_ADMIN', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: BUYER_COMPANY_ID, userId: BUYER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: SUPPLIER_COMPANY_ID, userId: BUYER_USER_ID, role: 'SUPPLIER_STAFF', status: 'ACTIVE', joinedAt: new Date() } });

  managerToken = (await createSession({ userId: MANAGER_USER_ID, activeCompanyId: MANAGER_COMPANY_ID })).token;
  superAdminToken = (await createSession({ userId: SUPER_ADMIN_USER_ID, activeCompanyId: SUPER_ADMIN_COMPANY_ID })).token;
  buyerToken = (await createSession({ userId: BUYER_USER_ID, activeCompanyId: BUYER_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { entityType: 'SupplierProfile', entityId: { in: [SUPPLIER_ID, ...createdSupplierIds] } } });
  await db.auditLog.deleteMany({ where: { entityType: 'SupplierMembers' } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, BUYER_COMPANY_ID, SUPPLIER_COMPANY_ID] } } });
  await db.supplierProfile.deleteMany({ where: { id: { in: [SUPPLIER_ID, ...createdSupplierIds] } } });
  await db.user.deleteMany({ where: { id: { in: [MANAGER_USER_ID, SUPER_ADMIN_USER_ID, BUYER_USER_ID] } } });
  await db.company.deleteMany({ where: { id: { in: [MANAGER_COMPANY_ID, SUPER_ADMIN_COMPANY_ID, BUYER_COMPANY_ID, SUPPLIER_COMPANY_ID, ...createdSupplierCompanyIds] } } });
});

describe('GET /api/admin/suppliers', () => {
  it('PLATFORM_SUPER_ADMIN can access the supplier list', async () => {
    const response = await adminSuppliersRoute(req(superAdminToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.some((s: { id: string }) => s.id === SUPPLIER_ID)).toBe(true);
  });

  it('PLATFORM_MANAGER can also access it - supplier moderation is not transaction access', async () => {
    const response = await adminSuppliersRoute(req(managerToken));
    expect(response.status).toBe(200);
  });

  it('an ordinary company user cannot access the platform supplier directory', async () => {
    const response = await adminSuppliersRoute(req(buyerToken));
    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await adminSuppliersRoute(new NextRequest('http://localhost/api/admin/suppliers'));
    expect(response.status).toBe(401);
  });

  it('returns productCount/memberCount/joinedAt for the management table, never sensitive/unrelated fields', async () => {
    const response = await adminSuppliersRoute(req(superAdminToken));
    const body: Record<string, unknown>[] = await response.json();
    const row = body.find((s) => s.id === SUPPLIER_ID);
    expect(row).toBeDefined();
    expect(row).toHaveProperty('productCount', 0);
    expect(row).toHaveProperty('memberCount', 1);
    expect(row).toHaveProperty('joinedAt');
    expect(row).not.toHaveProperty('passwordHash');
  });
});

describe('POST /api/admin/suppliers (Phase 28 - platform supplier creation)', () => {
  const newSupplierBody = { name: `Test Platform-Created Supplier ${Date.now()}`, city: 'Accra', country: 'GH', currency: 'GHS', description: 'A test supplier.' };

  it('PLATFORM_SUPER_ADMIN can create a new supplier (creates its own Company atomically)', async () => {
    const response = await createSupplierRoute(postReq(superAdminToken, newSupplierBody));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe(newSupplierBody.name);
    expect(body.verification).toBe('PENDING_VERIFICATION');
    createdSupplierIds.push(body.id);
    createdSupplierCompanyIds.push(body.companyId);

    const company = await db.company.findUnique({ where: { id: body.companyId } });
    expect(company?.isSupplier).toBe(true);
    expect(company?.isBuyer).toBe(false);

    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_SUPPLIER_CREATED', entityId: body.id } });
    expect(audit).not.toBeNull();
  });

  it('PLATFORM_MANAGER cannot create a supplier - creation is not the same as moderation', async () => {
    const response = await createSupplierRoute(postReq(managerToken, { name: 'Should Not Be Created', city: 'Accra', country: 'GH', currency: 'GHS', description: '' }));
    expect(response.status).toBe(403);
  });

  it('an ordinary company user cannot create a supplier', async () => {
    const response = await createSupplierRoute(postReq(buyerToken, { name: 'Should Not Be Created', city: 'Accra', country: 'GH', currency: 'GHS', description: '' }));
    expect(response.status).toBe(403);
  });

  it('rejects malformed input (missing required fields)', async () => {
    const response = await createSupplierRoute(postReq(superAdminToken, { name: '' }));
    expect(response.status).toBe(422);
  });
});

describe('PATCH /api/admin/suppliers/[supplierId] (Phase 28 - platform supplier editing)', () => {
  it('PLATFORM_SUPER_ADMIN can update an existing supplier\'s profile, never its verification status', async () => {
    const response = await updateSupplierRoute(
      patchReq(`/api/admin/suppliers/${SUPPLIER_ID}`, superAdminToken, { description: 'Updated description.' }),
      { params: Promise.resolve({ supplierId: SUPPLIER_ID }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.description).toBe('Updated description.');
    expect(body.verification).toBe('VERIFIED'); // unchanged - this route never touches it

    const audit = await db.auditLog.findFirst({ where: { action: 'PLATFORM_SUPPLIER_UPDATED', entityId: SUPPLIER_ID } });
    expect(audit).not.toBeNull();
  });

  it('PLATFORM_MANAGER cannot update supplier profile metadata', async () => {
    const response = await updateSupplierRoute(
      patchReq(`/api/admin/suppliers/${SUPPLIER_ID}`, managerToken, { description: 'Should not apply' }),
      { params: Promise.resolve({ supplierId: SUPPLIER_ID }) },
    );
    expect(response.status).toBe(403);
  });

  it('an ordinary company user cannot update a supplier profile', async () => {
    const response = await updateSupplierRoute(
      patchReq(`/api/admin/suppliers/${SUPPLIER_ID}`, buyerToken, { description: 'Should not apply' }),
      { params: Promise.resolve({ supplierId: SUPPLIER_ID }) },
    );
    expect(response.status).toBe(403);
  });
});

describe('GET /api/admin/suppliers/[supplierId]/members (Phase 28 - controlled member viewing)', () => {
  it('PLATFORM_SUPER_ADMIN can view a specific supplier\'s members, with only safe fields', async () => {
    const response = await supplierMembersRoute(req(superAdminToken), { params: Promise.resolve({ supplierId: SUPPLIER_ID }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBeGreaterThan(0);
    const member = body.find((m: { userId: string }) => m.userId === BUYER_USER_ID);
    expect(member).toBeDefined();
    expect(member.role).toBe('SUPPLIER_STAFF');
    expect(Object.keys(member).sort()).toEqual(['email', 'joinedAt', 'name', 'role', 'status', 'userId'].sort());
    expect(member).not.toHaveProperty('passwordHash');
  });

  it('PLATFORM_MANAGER cannot view supplier members', async () => {
    const response = await supplierMembersRoute(req(managerToken), { params: Promise.resolve({ supplierId: SUPPLIER_ID }) });
    expect(response.status).toBe(403);
  });

  it('an ordinary company user cannot enumerate a supplier\'s members through this platform route', async () => {
    const response = await supplierMembersRoute(req(buyerToken), { params: Promise.resolve({ supplierId: SUPPLIER_ID }) });
    expect(response.status).toBe(403);
  });
});
