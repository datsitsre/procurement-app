// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  createBudget,
  findApplicableBudget,
  getAlertThresholds,
  listBudgets,
  listUtilization,
  releaseBudget,
  removeBudget,
  reserveBudget,
  setAlertThresholds,
} from './budget.service';
import { createPurchaseRequest } from './procurement.service';

/**
 * Phase 15 - real, database-backed regression suite for budgets (createBudget/listBudgets/
 * removeBudget/listUtilization/alert-thresholds, plus the budget-enforcement primitives used by
 * procurement.service.ts#createPurchaseRequest). Runs against the actual dev Postgres database,
 * scoped to a dedicated test company this suite creates and cleans up in `afterAll`.
 */

const TEST_COMPANY_ID = `test-company-budget-${Date.now()}`;
const OTHER_COMPANY_ID = `test-company-budget-other-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-budget-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-budget-${Date.now()}`;
const TEST_PRODUCT_ID = `test-product-budget-${Date.now()}`;
const TEST_USER_ID = 'user-john-doe'; // seeded OWNER at company-acme-gh - no default spending limit, reused here
const ACTOR = { id: TEST_USER_ID, name: 'John Doe' };

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Budget Test Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({ data: { id: OTHER_COMPANY_ID, name: 'Budget Test Other Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Budget Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Budget Test Supplier',
      slug: `budget-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Budget Test Category', slug: `budget-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: TEST_PRODUCT_ID,
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Budget Test Widget',
      slug: `budget-test-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      moderationStatus: 'PUBLISHED',
    },
  });
  await db.companyMembership.create({
    data: { companyId: TEST_COMPANY_ID, userId: TEST_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
  });
});

afterAll(async () => {
  await db.purchaseRequestItem.deleteMany({ where: { request: { companyId: TEST_COMPANY_ID } } });
  await db.approvalStep.deleteMany({ where: { request: { companyId: TEST_COMPANY_ID } } });
  await db.purchaseRequest.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.budgetAlertSettings.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.budget.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.companyMembership.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.product.delete({ where: { id: TEST_PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: OTHER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('createBudget / listBudgets / removeBudget', () => {
  it('rejects a zero or negative amount', async () => {
    const result = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 0 }, ACTOR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('rejects a DEPARTMENT-scoped budget with no department given', async () => {
    const result = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'DEPARTMENT', period: 'ANNUAL', year: 2026, amount: 1000 }, ACTOR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_DEPARTMENT');
  });

  it('creates a company-wide annual budget, lists it, then removes it', async () => {
    const created = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: 2027, amount: 50000 }, ACTOR);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const list = await listBudgets(TEST_COMPANY_ID);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.some((b) => b.id === created.data.id)).toBe(true);

    const removed = await removeBudget(created.data.id, TEST_COMPANY_ID, ACTOR);
    expect(removed.ok).toBe(true);

    const listAfter = await listBudgets(TEST_COMPANY_ID);
    if (listAfter.ok) expect(listAfter.data.some((b) => b.id === created.data.id)).toBe(false);
  });

  it("tenant isolation - a budget cannot be removed through a different company's id", async () => {
    const created = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: 2028, amount: 1000 }, ACTOR);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wrongCompany = await removeBudget(created.data.id, OTHER_COMPANY_ID, ACTOR);
    expect(wrongCompany.ok).toBe(false);
    if (!wrongCompany.ok) expect(wrongCompany.error.code).toBe('NOT_FOUND');

    // Still there - the wrong-company attempt had no effect.
    const list = await listBudgets(TEST_COMPANY_ID);
    if (list.ok) expect(list.data.some((b) => b.id === created.data.id)).toBe(true);

    await removeBudget(created.data.id, TEST_COMPANY_ID, ACTOR);
  });
});

describe('alert thresholds', () => {
  it('defaults to the application default, then honors an override', async () => {
    const defaults = await getAlertThresholds(TEST_COMPANY_ID);
    expect(defaults.ok).toBe(true);
    if (defaults.ok) expect(defaults.data).toEqual([70, 85, 100]);

    const rejected = await setAlertThresholds(TEST_COMPANY_ID, [0], ACTOR);
    expect(rejected.ok).toBe(false);

    const set = await setAlertThresholds(TEST_COMPANY_ID, [50, 90], ACTOR);
    expect(set.ok).toBe(true);

    const updated = await getAlertThresholds(TEST_COMPANY_ID);
    if (updated.ok) expect(updated.data).toEqual([50, 90]);
  });
});

describe('listUtilization', () => {
  it("computes spend live from real PAID orders, not a stored total", async () => {
    const budget = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: 2029, amount: 1000 }, ACTOR);
    expect(budget.ok).toBe(true);
    if (!budget.ok) return;

    const order = await db.order.create({
      data: {
        reference: `ORD-BUDGET-${Date.now()}`,
        companyId: TEST_COMPANY_ID,
        supplierId: TEST_SUPPLIER_ID,
        subtotal: 400,
        tax: 0,
        deliveryFee: 0,
        total: 400,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        deliveryLocation: 'Accra',
        createdAt: new Date('2029-06-01'),
      },
    });

    const utilization = await listUtilization(TEST_COMPANY_ID);
    expect(utilization.ok).toBe(true);
    if (utilization.ok) {
      const row = utilization.data.find((u) => u.budget.id === budget.data.id);
      expect(row?.spent).toBe(400);
      expect(row?.remaining).toBe(600);
      expect(row?.percentUsed).toBe(40);
    }

    await db.order.delete({ where: { id: order.id } });
    await removeBudget(budget.data.id, TEST_COMPANY_ID, ACTOR);
  });
});

const CURRENT_YEAR = new Date().getFullYear();

describe('budget enforcement in createPurchaseRequest (section 6)', () => {
  it('rejects a purchase request that would exceed the applicable budget, and never reserves any of it', async () => {
    // createPurchaseRequest resolves the applicable budget against the real current date, never
    // a client-supplied one - the budget's own period must match *now*, not an arbitrary year.
    const budget = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: CURRENT_YEAR, amount: 1000 }, ACTOR);
    expect(budget.ok).toBe(true);
    if (!budget.ok) return;

    const overBudget = await createPurchaseRequest({
      companyId: TEST_COMPANY_ID,
      requesterUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Budget Test Widget', supplierId: TEST_SUPPLIER_ID, supplierName: 'Budget Test Supplier', quantity: 1, unitPrice: 5000 }],
      reason: 'Over budget test',
    });
    // Note: createPurchaseRequest computes totalAmount from items itself (subtotal + tax +
    // delivery), so this greatly exceeds the ₵1,000 budget regardless of the exact formula.
    expect(overBudget.ok).toBe(false);
    if (!overBudget.ok) expect(overBudget.error.code).toBe('BUDGET_EXCEEDED');

    const fresh = await db.budget.findUnique({ where: { id: budget.data.id } });
    expect(Number(fresh?.committedAmount)).toBe(0);

    await removeBudget(budget.data.id, TEST_COMPANY_ID, ACTOR);
  });

  it('admits a request within budget and reserves its committed amount; rejecting the request later releases it', async () => {
    const budget = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: CURRENT_YEAR, amount: 10000 }, ACTOR);
    expect(budget.ok).toBe(true);
    if (!budget.ok) return;

    const created = await createPurchaseRequest({
      companyId: TEST_COMPANY_ID,
      requesterUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Budget Test Widget', supplierId: TEST_SUPPLIER_ID, supplierName: 'Budget Test Supplier', quantity: 1, unitPrice: 100 }],
      reason: 'Within budget test',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const afterCreate = await db.budget.findUnique({ where: { id: budget.data.id } });
    expect(Number(afterCreate?.committedAmount)).toBe(created.data.totalAmount);

    // Reject it - via the same OWNER approval step (fallback band, single OWNER step).
    const { decideStep } = await import('./procurement.service');
    const decided = await decideStep(created.data.id, 'OWNER', 'REJECTED', TEST_USER_ID, 'John Doe', 'Not needed after all');
    expect(decided.ok).toBe(true);

    const afterReject = await db.budget.findUnique({ where: { id: budget.data.id } });
    expect(Number(afterReject?.committedAmount)).toBe(0);

    await removeBudget(budget.data.id, TEST_COMPANY_ID, ACTOR);
  });
});

describe('reserveBudget concurrency (section 31/32)', () => {
  it('two concurrent reservations that would together exceed the budget - only one ever succeeds', async () => {
    const budget = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: 2032, amount: 1000 }, ACTOR);
    expect(budget.ok).toBe(true);
    if (!budget.ok) return;

    // Fires both reservations genuinely concurrently, each inside its own transaction - the real
    // shape of two purchase requests racing the same budget.
    const [a, b] = await Promise.all([
      db.$transaction((tx) => reserveBudget(budget.data.id, 700, tx)),
      db.$transaction((tx) => reserveBudget(budget.data.id, 700, tx)),
    ]);

    const results = [a, b];
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => !r)).toHaveLength(1);

    const fresh = await db.budget.findUnique({ where: { id: budget.data.id } });
    expect(Number(fresh?.committedAmount)).toBe(700);

    await releaseBudget(budget.data.id, 700);
    await removeBudget(budget.data.id, TEST_COMPANY_ID, ACTOR);
  });
});

describe('findApplicableBudget', () => {
  it('prefers the most specific scope: cost center over department over company-wide', async () => {
    const costCenter = await db.costCenter.create({ data: { companyId: TEST_COMPANY_ID, code: 'CC-BUDGET', name: 'Budget Test CC' } });

    const company = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COMPANY', period: 'ANNUAL', year: 2033, amount: 1 }, ACTOR);
    const department = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'DEPARTMENT', department: 'Engineering', period: 'ANNUAL', year: 2033, amount: 2 }, ACTOR);
    const costCenterBudget = await createBudget({ companyId: TEST_COMPANY_ID, scope: 'COST_CENTER', costCenterId: costCenter.id, period: 'ANNUAL', year: 2033, amount: 3 }, ACTOR);
    expect(company.ok && department.ok && costCenterBudget.ok).toBe(true);
    if (!company.ok || !department.ok || !costCenterBudget.ok) return;

    const at = new Date('2033-05-01');
    const withCostCenter = await findApplicableBudget(TEST_COMPANY_ID, 'Engineering', costCenter.id, at);
    expect(withCostCenter?.id).toBe(costCenterBudget.data.id);

    const withDepartmentOnly = await findApplicableBudget(TEST_COMPANY_ID, 'Engineering', undefined, at);
    expect(withDepartmentOnly?.id).toBe(department.data.id);

    const companyWideOnly = await findApplicableBudget(TEST_COMPANY_ID, undefined, undefined, at);
    expect(companyWideOnly?.id).toBe(company.data.id);

    await removeBudget(company.data.id, TEST_COMPANY_ID, ACTOR);
    await removeBudget(department.data.id, TEST_COMPANY_ID, ACTOR);
    await removeBudget(costCenterBudget.data.id, TEST_COMPANY_ID, ACTOR);
    await db.costCenter.delete({ where: { id: costCenter.id } });
  });

  it('returns null when no budget applies at all - no configured budget is not a constraint', async () => {
    const result = await findApplicableBudget(TEST_COMPANY_ID, undefined, undefined, new Date('2099-01-01'));
    expect(result).toBeNull();
  });
});
