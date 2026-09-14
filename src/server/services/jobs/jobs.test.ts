// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { runInvoiceDueSweep } from './invoiceDueSweep';
import { runLowStockSweep } from './lowStockSweep';

/**
 * Deployment-readiness follow-up to Phase 14, Stage 9 - real, database-backed regression suite
 * for the two background sweeps that finally wire the INVOICE_DUE/LOW_STOCK notification types.
 * Runs against the actual dev Postgres database, scoped to dedicated test companies/suppliers/
 * products this suite creates and cleans up in `afterAll` - never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-jobs-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-jobs-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-jobs-${Date.now()}`;
const TEST_WAREHOUSE_ID = `test-warehouse-jobs-${Date.now()}`;
const OWNER_USER_ID = 'user-john-doe'; // reattached below so notifyCompanyRoles has someone to notify
const SUPPLIER_ADMIN_USER_ID = 'user-adwoa-mensah';

let overdueInvoiceId: string;
let notOverdueInvoiceId: string;
let lowStockProductId: string;
let okStockProductId: string;

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Jobs Test Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Jobs Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Jobs Test Supplier',
      slug: `jobs-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.companyMembership.createMany({
    data: [
      { companyId: TEST_COMPANY_ID, userId: OWNER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: `${TEST_SUPPLIER_ID}-company`, userId: SUPPLIER_ADMIN_USER_ID, role: 'SUPPLIER_ADMIN', status: 'ACTIVE', joinedAt: new Date() },
    ],
  });

  const overdue = await db.invoice.create({
    data: {
      reference: `INV-JOBS-OVERDUE-${Date.now()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      total: 1125,
      status: 'PENDING',
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
    },
  });
  overdueInvoiceId = overdue.id;

  const notYetDue = await db.invoice.create({
    data: {
      reference: `INV-JOBS-NOTDUE-${Date.now()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      total: 1125,
      status: 'PENDING',
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
    },
  });
  notOverdueInvoiceId = notYetDue.id;

  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Jobs Test Category', slug: `jobs-test-category-${Date.now()}` } });
  await db.warehouse.create({ data: { id: TEST_WAREHOUSE_ID, supplierId: TEST_SUPPLIER_ID, name: 'Jobs Test Warehouse', city: 'Accra' } });

  const lowStock = await db.product.create({
    data: {
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Jobs Low Stock Widget',
      slug: `jobs-low-stock-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      inventory: { create: [{ warehouseId: TEST_WAREHOUSE_ID, stock: 5, reserved: 0, lowStockThreshold: 10 }] },
    },
  });
  lowStockProductId = lowStock.id;

  const okStock = await db.product.create({
    data: {
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Jobs OK Stock Widget',
      slug: `jobs-ok-stock-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      inventory: { create: [{ warehouseId: TEST_WAREHOUSE_ID, stock: 500, reserved: 0, lowStockThreshold: 10 }] },
    },
  });
  okStockProductId = okStock.id;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { entityId: { in: [overdueInvoiceId, notOverdueInvoiceId, lowStockProductId, okStockProductId] } } });
  await db.invoice.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.inventoryRecord.deleteMany({ where: { warehouseId: TEST_WAREHOUSE_ID } });
  await db.product.deleteMany({ where: { supplierId: TEST_SUPPLIER_ID } });
  await db.warehouse.delete({ where: { id: TEST_WAREHOUSE_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.companyMembership.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, `${TEST_SUPPLIER_ID}-company`] } } });
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('runInvoiceDueSweep', () => {
  it('flips only the past-due PENDING invoice to OVERDUE and notifies the billed company', async () => {
    const result = await runInvoiceDueSweep();
    expect(result.markedOverdue).toBeGreaterThanOrEqual(1);

    const overdue = await db.invoice.findUnique({ where: { id: overdueInvoiceId } });
    expect(overdue?.status).toBe('OVERDUE');

    const notYetDue = await db.invoice.findUnique({ where: { id: notOverdueInvoiceId } });
    expect(notYetDue?.status).toBe('PENDING');

    const notification = await db.notification.findFirst({ where: { userId: OWNER_USER_ID, type: 'INVOICE_DUE', entityId: overdueInvoiceId } });
    expect(notification).not.toBeNull();
  });

  it('is safe to run again - an already-OVERDUE invoice is no longer PENDING, so it stays out of scope', async () => {
    const before = await db.notification.count({ where: { entityId: overdueInvoiceId } });
    await runInvoiceDueSweep();
    const after = await db.notification.count({ where: { entityId: overdueInvoiceId } });
    expect(after).toBe(before);
  });
});

describe('runLowStockSweep', () => {
  it('alerts the supplier for the low-stock product only, never the well-stocked one', async () => {
    const result = await runLowStockSweep();
    expect(result.alertsSent).toBeGreaterThanOrEqual(1);

    const lowStockAlert = await db.notification.findFirst({ where: { userId: SUPPLIER_ADMIN_USER_ID, type: 'LOW_STOCK', entityId: lowStockProductId } });
    expect(lowStockAlert).not.toBeNull();

    const okStockAlert = await db.notification.findFirst({ where: { type: 'LOW_STOCK', entityId: okStockProductId } });
    expect(okStockAlert).toBeNull();
  });

  it('does not double-alert the same product within the dedupe window', async () => {
    const before = await db.notification.count({ where: { entityId: lowStockProductId, type: 'LOW_STOCK' } });
    await runLowStockSweep();
    const after = await db.notification.count({ where: { entityId: lowStockProductId, type: 'LOW_STOCK' } });
    expect(after).toBe(before);
  });
});
