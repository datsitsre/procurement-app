// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  createRecurringPurchase,
  listRecurringPurchases,
  removeRecurringPurchase,
  runDueSchedules,
  setActive,
} from './recurringPurchase.service';

/**
 * Phase 15 - real, database-backed regression suite for recurring purchases: schedule CRUD,
 * pause/resume/cancel, the due-schedule sweep (idempotent, budget/approval-respecting, missed-
 * schedule handling, failure recording), and tenant isolation. Runs against the actual dev
 * Postgres database, scoped to a dedicated test company this suite creates and cleans up.
 */

const TEST_COMPANY_ID = `test-company-recurring-${Date.now()}`;
const OTHER_COMPANY_ID = `test-company-recurring-other-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-recurring-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-recurring-${Date.now()}`;
const TEST_PRODUCT_ID = `test-product-recurring-${Date.now()}`;
const TEST_USER_ID = 'user-john-doe';
const ACTOR = { id: TEST_USER_ID, name: 'John Doe' };

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Recurring Test Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({ data: { id: OTHER_COMPANY_ID, name: 'Recurring Test Other Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Recurring Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Recurring Test Supplier',
      slug: `recurring-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Recurring Test Category', slug: `recurring-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: TEST_PRODUCT_ID,
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Recurring Test Widget',
      slug: `recurring-test-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 50,
      moq: 1,
      moderationStatus: 'PUBLISHED',
    },
  });
  await db.companyMembership.create({
    data: { companyId: TEST_COMPANY_ID, userId: TEST_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
  });
});

afterAll(async () => {
  await db.recurringPurchaseRun.deleteMany({ where: { recurring: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } } });
  await db.recurringPurchaseItem.deleteMany({ where: { recurring: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } } });
  await db.recurringPurchase.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.purchaseRequestItem.deleteMany({ where: { request: { companyId: TEST_COMPANY_ID } } });
  await db.approvalStep.deleteMany({ where: { request: { companyId: TEST_COMPANY_ID } } });
  await db.purchaseRequest.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.companyMembership.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.product.delete({ where: { id: TEST_PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: OTHER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

const ITEM = { productId: TEST_PRODUCT_ID, productName: 'Recurring Test Widget', quantity: 1 };

describe('createRecurringPurchase / setActive / removeRecurringPurchase', () => {
  it('rejects an empty name and an empty item list', async () => {
    const noName = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: ' ', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(noName.ok).toBe(false);
    const noItems = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'x', items: [], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(noItems.ok).toBe(false);
  });

  it('creates a schedule active by default, with nextRunAt in the future', async () => {
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Weekly Widgets', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.active).toBe(true);
    expect(new Date(created.data.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('pause/resume flips active, tenant-isolated', async () => {
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Pausable', items: [ITEM], frequency: 'MONTHLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wrongCompany = await setActive(created.data.id, OTHER_COMPANY_ID, false, ACTOR);
    expect(wrongCompany.ok).toBe(false);
    if (!wrongCompany.ok) expect(wrongCompany.error.code).toBe('NOT_FOUND');

    const paused = await setActive(created.data.id, TEST_COMPANY_ID, false, ACTOR);
    expect(paused.ok).toBe(true);
    if (paused.ok) expect(paused.data.active).toBe(false);

    const resumed = await setActive(created.data.id, TEST_COMPANY_ID, true, ACTOR);
    if (resumed.ok) expect(resumed.data.active).toBe(true);

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it("tenant isolation - cannot cancel another company's schedule", async () => {
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Isolated', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wrongCompany = await removeRecurringPurchase(created.data.id, OTHER_COMPANY_ID, ACTOR);
    expect(wrongCompany.ok).toBe(false);

    const stillThere = await listRecurringPurchases(TEST_COMPANY_ID);
    if (stillThere.ok) expect(stillThere.data.some((s) => s.id === created.data.id)).toBe(true);

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });
});

describe('runDueSchedules (section 20/21/22/23/26)', () => {
  it('a schedule not yet due is skipped - no purchase request is created', async () => {
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Not Due Yet', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outcome = await runDueSchedules({ companyId: TEST_COMPANY_ID });
    const schedules = await listRecurringPurchases(TEST_COMPANY_ID);
    if (schedules.ok) {
      const mine = schedules.data.find((s) => s.id === created.data.id);
      expect(mine?.createdPurchaseRequestIds).toHaveLength(0);
    }
    expect(outcome.createdPurchaseRequestIds).not.toContain(created.data.id);

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('a due schedule generates a real purchase request through the normal approval pipeline, then advances to its next occurrence', async () => {
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Due Now', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Force it due - directly, since createRecurringPurchase always sets a future nextRunAt.
    await db.recurringPurchase.update({ where: { id: created.data.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });

    const outcome = await runDueSchedules({ companyId: TEST_COMPANY_ID });
    expect(outcome.ranCount).toBe(1);
    expect(outcome.createdPurchaseRequestIds).toHaveLength(1);

    const pr = await db.purchaseRequest.findUnique({ where: { id: outcome.createdPurchaseRequestIds[0] } });
    expect(pr).not.toBeNull();
    expect(pr?.status).toBe('IN_APPROVAL'); // went through the same approval pipeline, not a bypass

    const run = await db.recurringPurchaseRun.findFirst({ where: { recurringId: created.data.id } });
    expect(run?.status).toBe('SUCCEEDED');
    expect(run?.purchaseRequestId).toBe(outcome.createdPurchaseRequestIds[0]);

    const updated = await db.recurringPurchase.findUnique({ where: { id: created.data.id } });
    expect(updated?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(updated?.lastRunAt).not.toBeNull();

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('the underlying atomic claim itself - two concurrent conditional updates for the same occurrence - only one can ever win (section 22, deterministic SQL-level guarantee)', async () => {
    // Isolates the exact database-level mechanism runDueSchedules relies on, without the many
    // async hops (product lookup, purchase-request creation) in between that make a full
    // end-to-end Promise.all race non-deterministic in a single Node process (the two calls can
    // easily fail to overlap at the one instant that matters). This is the same technique used
    // to prove reserveBudget's concurrency safety, and the same underlying guarantee.
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Claim Race', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const occurrenceAt = new Date(Date.now() - 1000);
    await db.recurringPurchase.update({ where: { id: created.data.id }, data: { nextRunAt: occurrenceAt } });

    const claim = () =>
      db.recurringPurchase.updateMany({
        where: { id: created.data.id, nextRunAt: occurrenceAt, active: true },
        data: { nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), lastRunAt: new Date() },
      });
    const [a, b] = await Promise.all([claim(), claim()]);
    expect([a.count, b.count].sort()).toEqual([0, 1]);

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('two concurrent sweeps racing the same due schedule never both create a purchase request (section 22 - idempotency)', async () => {
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Race Test', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await db.recurringPurchase.update({ where: { id: created.data.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });

    const [a, b] = await Promise.all([runDueSchedules({ companyId: TEST_COMPANY_ID }), runDueSchedules({ companyId: TEST_COMPANY_ID })]);

    const allCreated = [...a.createdPurchaseRequestIds, ...b.createdPurchaseRequestIds];
    expect(allCreated).toHaveLength(1);

    const runs = await db.recurringPurchaseRun.findMany({ where: { recurringId: created.data.id } });
    expect(runs).toHaveLength(1);

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('a schedule missed for several occurrences creates exactly one purchase request and fast-forwards to the next future occurrence (section 23 - missed schedules)', async () => {
    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Long Missed', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Simulate the scheduler having been offline for 10 weeks - nextRunAt is 10 weeks in the past.
    const tenWeeksAgo = new Date(Date.now() - 10 * 7 * 24 * 60 * 60 * 1000);
    await db.recurringPurchase.update({ where: { id: created.data.id }, data: { nextRunAt: tenWeeksAgo } });

    const outcome = await runDueSchedules({ companyId: TEST_COMPANY_ID });
    // Exactly one request for the whole 10-week gap, never one per missed week.
    expect(outcome.createdPurchaseRequestIds).toHaveLength(1);

    const runs = await db.recurringPurchaseRun.findMany({ where: { recurringId: created.data.id } });
    expect(runs).toHaveLength(1);

    const updated = await db.recurringPurchase.findUnique({ where: { id: created.data.id } });
    expect(updated?.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('a schedule whose product is no longer published is skipped, recorded SKIPPED, and creates no purchase request', async () => {
    const created = await createRecurringPurchase({
      companyId: TEST_COMPANY_ID,
      name: 'Unavailable Product',
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Recurring Test Widget', quantity: 1 }],
      frequency: 'WEEKLY',
      requesterUserId: TEST_USER_ID,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await db.recurringPurchase.update({ where: { id: created.data.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await db.product.update({ where: { id: TEST_PRODUCT_ID }, data: { moderationStatus: 'REJECTED' } });

    const outcome = await runDueSchedules({ companyId: TEST_COMPANY_ID });
    expect(outcome.createdPurchaseRequestIds).toHaveLength(0);
    expect(outcome.warnings.some((w) => w.includes('no longer available'))).toBe(true);

    const run = await db.recurringPurchaseRun.findFirst({ where: { recurringId: created.data.id } });
    expect(run?.status).toBe('SKIPPED');

    await db.product.update({ where: { id: TEST_PRODUCT_ID }, data: { moderationStatus: 'PUBLISHED' } });
    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('a schedule that fails to generate a request (e.g. exceeds a budget) is recorded FAILED, without creating a purchase request, and the occurrence is still consumed', async () => {
    const { createBudget, removeBudget } = await import('./budget.service');
    const budget = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: new Date().getFullYear(), amount: 1 }, ACTOR);
    expect(budget.ok).toBe(true);
    if (!budget.ok) return;

    const created = await createRecurringPurchase({ companyId: TEST_COMPANY_ID, name: 'Over Budget Schedule', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await db.recurringPurchase.update({ where: { id: created.data.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });

    const outcome = await runDueSchedules({ companyId: TEST_COMPANY_ID });
    expect(outcome.createdPurchaseRequestIds).toHaveLength(0);
    expect(outcome.warnings.some((w) => w.includes('Over Budget Schedule'))).toBe(true);

    const run = await db.recurringPurchaseRun.findFirst({ where: { recurringId: created.data.id } });
    expect(run?.status).toBe('FAILED');
    expect(run?.purchaseRequestId).toBeNull();

    // The occurrence was still consumed - nextRunAt moved on, so a permanently-failing schedule
    // surfaces once per real occurrence rather than being retried into a tight failure loop.
    const updated = await db.recurringPurchase.findUnique({ where: { id: created.data.id } });
    expect(updated?.nextRunAt.getTime()).toBeGreaterThan(Date.now());

    await removeBudget(budget.data.id, TEST_COMPANY_ID, ACTOR);
    await removeRecurringPurchase(created.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it("tenant isolation - runDueSchedules scoped to one company never touches another company's due schedule", async () => {
    const other = await createRecurringPurchase({ companyId: OTHER_COMPANY_ID, name: 'Other Co Schedule', items: [ITEM], frequency: 'WEEKLY', requesterUserId: TEST_USER_ID });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    await db.recurringPurchase.update({ where: { id: other.data.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });

    const outcome = await runDueSchedules({ companyId: TEST_COMPANY_ID });
    expect(outcome.createdPurchaseRequestIds).not.toContain(other.data.id);
    const stillDue = await db.recurringPurchase.findUnique({ where: { id: other.data.id } });
    expect(stillDue?.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now()); // untouched - still due

    await removeRecurringPurchase(other.data.id, OTHER_COMPANY_ID, ACTOR);
  });
});
