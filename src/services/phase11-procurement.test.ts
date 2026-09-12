import { beforeEach, describe, expect, it } from 'vitest';
import { procurementService } from './procurement.service';
import { templatesService } from './templates.service';
import { budgetsService } from './budgets.service';
import { recurringService } from './recurring.service';
import { spendingLimitFor, companyService } from './company.service';
import { DefaultSpendingLimits } from '@/config/spending-limits';
import { Role } from '@/config/rbac';
import type { PurchaseRequestItem } from '@/types/procurement';

/**
 * Phase 11 (Advanced Procurement) regression suite - one of Rule 10's "every new mutation needs
 * authorization tests" for each Phase 11 mutation: purchase templates, spending limits, budgets,
 * and recurring purchases. Cross-tenant cases must fail closed with NOT_FOUND (never leak that
 * the record exists), and the spending-limit cases must confirm the rule layers strictly on top
 * of - never in place of - the existing RBAC permission check (section 11.5).
 */

const MY_COMPANY = { companyId: 'company-acme-gh' };
const OTHER_COMPANY = { companyId: 'company-not-mine' };
const PLATFORM_ADMIN = { isPlatformAdmin: true };

function requestItem(overrides: Partial<PurchaseRequestItem> = {}): PurchaseRequestItem {
  return {
    id: 'pri-test-1',
    productId: 'prod-cisco-switch',
    productName: 'Cisco switch',
    supplierId: 'supplier-abc',
    supplierName: 'ABC Supplies',
    quantity: 1,
    unitPrice: 100,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Purchase templates (section 11.0)', () => {
  it('creates and lists a template scoped to the company', async () => {
    const created = await templatesService.createTemplate(
      { companyId: 'company-acme-gh', name: 'Office setup', createdByUserId: 'user-1', items: [{ productId: 'prod-cisco-switch', productName: 'Cisco switch', quantity: 2 }] },
      Role.BUYER,
    );
    expect(created.ok).toBe(true);

    const list = await templatesService.listTemplates('company-acme-gh');
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.some((t) => t.name === 'Office setup')).toBe(true);
  });

  it('refuses a role without purchase_request.create from saving a template', async () => {
    const result = await templatesService.createTemplate(
      { companyId: 'company-acme-gh', name: 'Nope', createdByUserId: 'user-1', items: [{ productId: 'p', productName: 'p', quantity: 1 }] },
      Role.PLATFORM_ADMIN, // platform admin role has no company-scoped purchasing permission
    );
    expect(result.ok).toBe(false);
  });

  it("refuses removing another company's template", async () => {
    const created = await templatesService.createTemplate(
      { companyId: 'company-acme-gh', name: 'Mine', createdByUserId: 'user-1', items: [{ productId: 'p', productName: 'p', quantity: 1 }] },
      Role.BUYER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const removed = await templatesService.removeTemplate(created.data.id, Role.BUYER, OTHER_COMPANY);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('NOT_FOUND');

    // the real owner can still remove it
    const removedByOwner = await templatesService.removeTemplate(created.data.id, Role.BUYER, MY_COMPANY);
    expect(removedByOwner.ok).toBe(true);
  });
});

describe('Spending limits (section 11.5 - a business rule additive to, never a replacement for, RBAC)', () => {
  it('rejects a purchase request over the caller role default limit even though the role has permission to create requests', async () => {
    const limit = DefaultSpendingLimits[Role.EMPLOYEE]!;
    const result = await procurementService.createPurchaseRequest(
      {
        companyId: 'company-acme-gh',
        requesterUserId: 'user-1',
        requesterName: 'Test Employee',
        items: [requestItem({ quantity: 1000, unitPrice: limit })], // total far exceeds the limit
        reason: 'Over-limit test',
      },
      Role.EMPLOYEE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SPENDING_LIMIT_EXCEEDED');
  });

  it('allows a purchase request at or under the role limit', async () => {
    const result = await procurementService.createPurchaseRequest(
      {
        companyId: 'company-acme-gh',
        requesterUserId: 'user-1',
        requesterName: 'Test Employee',
        items: [requestItem({ quantity: 1, unitPrice: 100 })], // subtotal + tax + delivery stays comfortably under the limit
        reason: 'Under-limit test',
      },
      Role.EMPLOYEE,
    );
    expect(result.ok).toBe(true);
  });

  it('still refuses a role lacking purchase_request.create regardless of amount (permission check runs first)', async () => {
    const result = await procurementService.createPurchaseRequest(
      {
        companyId: 'company-acme-gh',
        requesterUserId: 'user-1',
        requesterName: 'Nobody',
        items: [requestItem({ quantity: 1, unitPrice: 1 })],
        reason: 'Should never pass the permission gate',
      },
      Role.PLATFORM_ADMIN,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).not.toBe('SPENDING_LIMIT_EXCEEDED');
  });

  it('a company-configured override changes the effective limit', async () => {
    const before = spendingLimitFor('company-acme-gh', Role.EMPLOYEE);
    expect(before).toBe(DefaultSpendingLimits[Role.EMPLOYEE]);

    const setResult = await companyService.setSpendingLimit('company-acme-gh', Role.EMPLOYEE, 5, Role.OWNER, MY_COMPANY);
    expect(setResult.ok).toBe(true);

    expect(spendingLimitFor('company-acme-gh', Role.EMPLOYEE)).toBe(5);

    const result = await procurementService.createPurchaseRequest(
      {
        companyId: 'company-acme-gh',
        requesterUserId: 'user-1',
        requesterName: 'Test Employee',
        items: [requestItem({ quantity: 1, unitPrice: 50 })], // was fine before the override, now over the new limit of 5
        reason: 'Now over the lowered limit',
      },
      Role.EMPLOYEE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SPENDING_LIMIT_EXCEEDED');
  });

  it("refuses setting another company's spending limit", async () => {
    const result = await companyService.setSpendingLimit('company-acme-gh', Role.EMPLOYEE, 1, Role.OWNER, OTHER_COMPANY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('Procurement budgets (section 11.3/11.4)', () => {
  it('creates a budget and computes utilization live from paid orders (never a stored total)', async () => {
    const created = await budgetsService.createBudget(
      { companyId: 'company-acme-gh', scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 1000 },
      Role.OWNER,
      MY_COMPANY,
    );
    expect(created.ok).toBe(true);

    const utilization = await budgetsService.listUtilization('company-acme-gh');
    expect(utilization.ok).toBe(true);
    if (utilization.ok) {
      const row = utilization.data.find((u) => created.ok && u.budget.id === created.data.id);
      expect(row).toBeDefined();
      // percentUsed is always re-derived, never persisted
      expect(row!.percentUsed).toBe(Math.round((row!.spent / row!.budget.amount) * 100));
    }
  });

  it('refuses a role without settings.manage from creating a budget', async () => {
    const result = await budgetsService.createBudget(
      { companyId: 'company-acme-gh', scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 1000 },
      Role.EMPLOYEE,
      MY_COMPANY,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses creating a budget for another company", async () => {
    const result = await budgetsService.createBudget(
      { companyId: 'company-acme-gh', scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 1000 },
      Role.OWNER,
      OTHER_COMPANY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it("refuses removing another company's budget", async () => {
    const created = await budgetsService.createBudget(
      { companyId: 'company-acme-gh', scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 1000 },
      Role.OWNER,
      MY_COMPANY,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const removed = await budgetsService.removeBudget(created.data.id, Role.OWNER, OTHER_COMPANY);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('NOT_FOUND');
  });

  it('platform admin can manage thresholds for any company', async () => {
    const result = await budgetsService.setAlertThresholds('company-acme-gh', [60, 80], Role.ADMIN, PLATFORM_ADMIN);
    expect(result.ok).toBe(true);
    const thresholds = await budgetsService.getAlertThresholds('company-acme-gh');
    expect(thresholds.ok).toBe(true);
    if (thresholds.ok) expect(thresholds.data).toEqual([60, 80]);
  });
});

describe('Recurring purchases (section 11.2 - must go through real approval, never bypass it)', () => {
  it('creates a schedule and, once due, submits a real purchase request through procurement.service (not a bypass)', async () => {
    const created = await recurringService.createRecurringPurchase(
      {
        companyId: 'company-acme-gh',
        name: 'Weekly switches',
        items: [{ productId: 'prod-cisco-switch', productName: 'Cisco switch', quantity: 1 }],
        frequency: 'WEEKLY',
        requesterUserId: 'user-1',
        requesterName: 'Test Buyer',
      },
      Role.BUYER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Force it due immediately by rewriting its nextRunAt into the past.
    const list = JSON.parse(window.localStorage.getItem('procurement.recurring-purchases.v1.list')!);
    list[0].nextRunAt = new Date(0).toISOString();
    window.localStorage.setItem('procurement.recurring-purchases.v1.list', JSON.stringify(list));

    const before = await procurementService.listPurchaseRequests('company-acme-gh');
    const beforeCount = before.ok ? before.data.length : 0;

    const run = await recurringService.runDue('company-acme-gh', Role.BUYER, MY_COMPANY);
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.data.ranCount).toBe(1);
      expect(run.data.createdPurchaseRequestIds.length).toBe(1);
    }

    const after = await procurementService.listPurchaseRequests('company-acme-gh');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.data.length).toBe(beforeCount + 1);

    // Each run only appends its own schedule's newly-created id, never the whole batch's ids.
    const schedules = await recurringService.listRecurringPurchases('company-acme-gh');
    expect(schedules.ok).toBe(true);
    if (schedules.ok) {
      const schedule = schedules.data.find((s) => s.name === 'Weekly switches');
      expect(schedule?.createdPurchaseRequestIds.length).toBe(1);
    }
  });

  it("refuses running due schedules for another company", async () => {
    const result = await recurringService.runDue('company-acme-gh', Role.BUYER, OTHER_COMPANY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it("refuses pausing or removing another company's schedule", async () => {
    const created = await recurringService.createRecurringPurchase(
      {
        companyId: 'company-acme-gh',
        name: 'Mine',
        items: [{ productId: 'prod-cisco-switch', productName: 'Cisco switch', quantity: 1 }],
        frequency: 'MONTHLY',
        requesterUserId: 'user-1',
        requesterName: 'Test Buyer',
      },
      Role.BUYER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const paused = await recurringService.setActive(created.data.id, false, Role.BUYER, OTHER_COMPANY);
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.error.code).toBe('NOT_FOUND');

    const removed = await recurringService.removeRecurringPurchase(created.data.id, Role.BUYER, OTHER_COMPANY);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('NOT_FOUND');
  });
});
