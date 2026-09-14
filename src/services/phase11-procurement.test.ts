import { beforeEach, describe, expect, it } from 'vitest';
import { templatesService } from './templates.service';
import { budgetsService } from './budgets.service';
import { recurringService } from './recurring.service';
import { Role } from '@/config/rbac';

/**
 * Phase 11 (Advanced Procurement) regression suite - one of Rule 10's "every new mutation needs
 * authorization tests" for each Phase 11 mutation: purchase templates, budgets, and recurring
 * purchases (spending limits moved to the server-side suite - see the comment below). Cross-
 * tenant cases must fail closed with NOT_FOUND (never leak that the record exists).
 */

const MY_COMPANY = { companyId: 'company-acme-gh' };
const OTHER_COMPANY = { companyId: 'company-not-mine' };
const PLATFORM_ADMIN = { isPlatformAdmin: true };

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

// Spending-limit enforcement + override coverage moved to server/services/procurement.service.
// test.ts and server/services/company.service.test.ts (Phase 14, Stage 6) -
// procurementService.createPurchaseRequest and companyService.setSpendingLimit/
// listSpendingLimits are now real fetch() calls with no live server during `vitest run`, the
// same reason Stage 4/5 retired their equivalent client-mock describe blocks.

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
  // "creates a schedule and, once due, submits a real purchase request..." moved to
  // server/services/procurement.service.test.ts's own recurring-purchase coverage (Phase 14,
  // Stage 6) - runDue calls procurementService.createPurchaseRequest, now a real fetch() with no
  // live server during `vitest run`, the same reason the spending-limit tests above moved.

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
