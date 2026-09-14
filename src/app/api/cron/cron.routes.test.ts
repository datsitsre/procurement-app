// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { POST as invoiceDueSweepRoute } from './invoice-due-sweep/route';
import { POST as lowStockSweepRoute } from './low-stock-sweep/route';

/**
 * Deployment-readiness follow-up to Phase 14, Stage 9 - regression suite at the real API
 * boundary for the two cron sweep routes: shared-secret enforcement (not cookie/session auth -
 * an external scheduler calls these server-to-server, see requireCronSecret's own comment) and
 * the actual route wiring around each sweep.
 */

const TEST_COMPANY_ID = `test-company-cron-routes-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-cron-routes-${Date.now()}`;
const OWNER_USER_ID = 'user-john-doe';

let overdueInvoiceId: string;

function requestFor(url: string, secret: string | null) {
  const headers = new Headers();
  if (secret !== null) headers.set('x-cron-secret', secret);
  return new NextRequest(url, { method: 'POST', headers });
}

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Cron Routes Test Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Cron Routes Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Cron Routes Test Supplier',
      slug: `cron-routes-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.companyMembership.create({
    data: { companyId: TEST_COMPANY_ID, userId: OWNER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const invoice = await db.invoice.create({
    data: {
      reference: `INV-CRON-ROUTES-${Date.now()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      total: 1125,
      status: 'PENDING',
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  overdueInvoiceId = invoice.id;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { entityId: overdueInvoiceId } });
  await db.invoice.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.companyMembership.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('POST /api/cron/invoice-due-sweep', () => {
  it('rejects a request with no secret header', async () => {
    const response = await invoiceDueSweepRoute(requestFor('http://localhost/api/cron/invoice-due-sweep', null));
    expect(response.status).toBe(401);
  });

  it('rejects a request with a wrong secret', async () => {
    const response = await invoiceDueSweepRoute(requestFor('http://localhost/api/cron/invoice-due-sweep', 'wrong-secret'));
    expect(response.status).toBe(401);
  });

  it('accepts the correct secret and flips the overdue invoice', async () => {
    const response = await invoiceDueSweepRoute(requestFor('http://localhost/api/cron/invoice-due-sweep', env.CRON_SECRET));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.markedOverdue).toBeGreaterThanOrEqual(1);

    const invoice = await db.invoice.findUnique({ where: { id: overdueInvoiceId } });
    expect(invoice?.status).toBe('OVERDUE');
  });
});

describe('POST /api/cron/low-stock-sweep', () => {
  it('rejects a request with no secret header', async () => {
    const response = await lowStockSweepRoute(requestFor('http://localhost/api/cron/low-stock-sweep', null));
    expect(response.status).toBe(401);
  });

  it('rejects a request with a wrong secret', async () => {
    const response = await lowStockSweepRoute(requestFor('http://localhost/api/cron/low-stock-sweep', 'wrong-secret'));
    expect(response.status).toBe(401);
  });

  it('accepts the correct secret and returns the expected result shape', async () => {
    const response = await lowStockSweepRoute(requestFor('http://localhost/api/cron/low-stock-sweep', env.CRON_SECRET));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(typeof json.alertsSent).toBe('number');
  });
});
