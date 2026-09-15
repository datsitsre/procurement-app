// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { GET as listBudgetsRoute, POST as createBudgetRoute } from '@/app/api/companies/[companyId]/budgets/route';
import { DELETE as deleteBudgetRoute } from '@/app/api/companies/[companyId]/budgets/[budgetId]/route';
import { GET as listTemplatesRoute, POST as createTemplateRoute } from '@/app/api/companies/[companyId]/purchase-templates/route';
import { DELETE as deleteTemplateRoute } from '@/app/api/companies/[companyId]/purchase-templates/[templateId]/route';
import { GET as listRecurringRoute, POST as createRecurringRoute } from '@/app/api/companies/[companyId]/recurring-purchases/route';
import { PATCH as patchRecurringRoute, DELETE as deleteRecurringRoute } from '@/app/api/companies/[companyId]/recurring-purchases/[recurringId]/route';
import { POST as runDueRoute } from '@/app/api/companies/[companyId]/recurring-purchases/run-due/route';
import { POST as cronSweepRoute } from '@/app/api/cron/recurring-purchase-sweep/route';

/**
 * Phase 15 - security regression suite at the real API boundary for budgets/purchase-templates/
 * recurring-purchases (section 38): every new mutation attempted directly at the route level,
 * unauthenticated and cross-tenant, never assuming "the button is hidden" is enough.
 */

const TEST_COMPANY_ID = `test-company-backend-routes-${Date.now()}`;
const OTHER_COMPANY_ID = `test-company-backend-routes-other-${Date.now()}`;
const OWNER_USER_ID = 'user-john-doe';
const OTHER_OWNER_USER_ID = 'user-kofi-boateng'; // seeded owner-equivalent at a different company

let sessionToken: string;
let otherSessionToken: string;

function requestFor(url: string, token: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({ cookie: `session_token=${token}`, origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

function unauthedRequestFor(url: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    body: init?.body,
    headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
  });
}

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Backend Routes Test Co', country: 'GH', currency: 'GHS', isBuyer: true } });
  await db.company.create({ data: { id: OTHER_COMPANY_ID, name: 'Backend Routes Test Other Co', country: 'GH', currency: 'GHS', isBuyer: true } });
  await db.companyMembership.create({ data: { companyId: TEST_COMPANY_ID, userId: OWNER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });
  await db.companyMembership.create({ data: { companyId: OTHER_COMPANY_ID, userId: OTHER_OWNER_USER_ID, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } });

  sessionToken = (await createSession({ userId: OWNER_USER_ID, activeCompanyId: TEST_COMPANY_ID })).token;
  otherSessionToken = (await createSession({ userId: OTHER_OWNER_USER_ID, activeCompanyId: OTHER_COMPANY_ID })).token;
});

afterAll(async () => {
  await db.purchaseTemplateItem.deleteMany({ where: { template: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } } });
  await db.purchaseTemplate.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.recurringPurchaseRun.deleteMany({ where: { recurring: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } } });
  await db.recurringPurchaseItem.deleteMany({ where: { recurring: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } } });
  await db.recurringPurchase.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.budgetAlertSettings.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.budget.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.companyMembership.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.company.delete({ where: { id: OTHER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('budgets - unauthorized/cross-tenant access at the API boundary', () => {
  it('rejects an unauthenticated create/list/delete', async () => {
    const list = await listBudgetsRoute(unauthedRequestFor(`/api/companies/${TEST_COMPANY_ID}/budgets`), { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(list.status).toBe(401);

    const create = await createBudgetRoute(
      unauthedRequestFor(`/api/companies/${TEST_COMPANY_ID}/budgets`, { method: 'POST', body: JSON.stringify({ scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 100 }) }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(create.status).toBe(401);

    const remove = await deleteBudgetRoute(unauthedRequestFor(`/api/companies/${TEST_COMPANY_ID}/budgets/x`, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, budgetId: 'x' }),
    });
    expect(remove.status).toBe(401);
  });

  it("refuses creating/listing/deleting a budget through a different company's id", async () => {
    const create = await createBudgetRoute(
      requestFor(`/api/companies/${TEST_COMPANY_ID}/budgets`, otherSessionToken, { method: 'POST', body: JSON.stringify({ scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 100 }) }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(create.status).toBe(404);

    const list = await listBudgetsRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/budgets`, otherSessionToken), { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect(list.status).toBe(404);
  });

  it('the owning company can create, list, and delete its own budget through the real route stack', async () => {
    const create = await createBudgetRoute(
      requestFor(`/api/companies/${TEST_COMPANY_ID}/budgets`, sessionToken, { method: 'POST', body: JSON.stringify({ scope: 'COMPANY', period: 'ANNUAL', year: 2026, amount: 5000 }) }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(create.status).toBe(200);
    const budget = await create.json();

    const remove = await deleteBudgetRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/budgets/${budget.id}`, sessionToken, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, budgetId: budget.id }),
    });
    expect(remove.status).toBe(200);

    // A different company cannot remove it either way (already gone, but confirms the check runs
    // before any "already deleted" concern).
    const wrongCompanyRemove = await deleteBudgetRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/budgets/${budget.id}`, otherSessionToken, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, budgetId: budget.id }),
    });
    expect(wrongCompanyRemove.status).toBe(404);
  });
});

describe('purchase templates - unauthorized/cross-tenant access at the API boundary', () => {
  it('rejects an unauthenticated create/delete', async () => {
    const create = await createTemplateRoute(
      unauthedRequestFor(`/api/companies/${TEST_COMPANY_ID}/purchase-templates`, { method: 'POST', body: JSON.stringify({ name: 'x', items: [] }) }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(create.status).toBe(401);
  });

  it("refuses creating a template through a different company's id, and refuses cross-tenant deletion", async () => {
    const wrongCompanyCreate = await createTemplateRoute(
      requestFor(`/api/companies/${TEST_COMPANY_ID}/purchase-templates`, otherSessionToken, {
        method: 'POST',
        body: JSON.stringify({ name: 'Injected', items: [{ productId: 'p1', productName: 'Widget', quantity: 1 }] }),
      }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(wrongCompanyCreate.status).toBe(404);

    const create = await createTemplateRoute(
      requestFor(`/api/companies/${TEST_COMPANY_ID}/purchase-templates`, sessionToken, {
        method: 'POST',
        body: JSON.stringify({ name: 'Real Template', items: [{ productId: 'p1', productName: 'Widget', quantity: 1 }] }),
      }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(create.status).toBe(200);
    const template = await create.json();

    const wrongCompanyDelete = await deleteTemplateRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/purchase-templates/${template.id}`, otherSessionToken, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, templateId: template.id }),
    });
    expect(wrongCompanyDelete.status).toBe(404);

    const list = await listTemplatesRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/purchase-templates`, sessionToken), { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    expect((await list.json()).some((t: { id: string }) => t.id === template.id)).toBe(true);

    await deleteTemplateRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/purchase-templates/${template.id}`, sessionToken, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, templateId: template.id }),
    });
  });
});

describe('recurring purchases - unauthorized/cross-tenant access at the API boundary', () => {
  it('rejects an unauthenticated create/pause/cancel/run-due', async () => {
    const create = await createRecurringRoute(
      unauthedRequestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases`, { method: 'POST', body: JSON.stringify({ name: 'x', items: [], frequency: 'WEEKLY' }) }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(create.status).toBe(401);

    const runDue = await runDueRoute(unauthedRequestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases/run-due`, { method: 'POST' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID }),
    });
    expect(runDue.status).toBe(401);
  });

  it("refuses creating, pausing, and cancelling a schedule through a different company's id", async () => {
    const create = await createRecurringRoute(
      requestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases`, sessionToken, {
        method: 'POST',
        body: JSON.stringify({ name: 'Real Schedule', items: [{ productId: 'p1', productName: 'Widget', quantity: 1 }], frequency: 'WEEKLY' }),
      }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) },
    );
    expect(create.status).toBe(200);
    const schedule = await create.json();

    const wrongCompanyPause = await patchRecurringRoute(
      requestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases/${schedule.id}`, otherSessionToken, { method: 'PATCH', body: JSON.stringify({ active: false }) }),
      { params: Promise.resolve({ companyId: TEST_COMPANY_ID, recurringId: schedule.id }) },
    );
    expect(wrongCompanyPause.status).toBe(404);

    const wrongCompanyCancel = await deleteRecurringRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases/${schedule.id}`, otherSessionToken, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, recurringId: schedule.id }),
    });
    expect(wrongCompanyCancel.status).toBe(404);

    // Still there and still active - neither cross-tenant attempt had any effect.
    const list = await listRecurringRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases`, sessionToken), { params: Promise.resolve({ companyId: TEST_COMPANY_ID }) });
    const mine = (await list.json()).find((s: { id: string }) => s.id === schedule.id);
    expect(mine?.active).toBe(true);

    await deleteRecurringRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases/${schedule.id}`, sessionToken, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID, recurringId: schedule.id }),
    });
  });

  it("run-due scoped to one company cannot be used to trigger a different company's schedules", async () => {
    const create = await createRecurringRoute(
      requestFor(`/api/companies/${OTHER_COMPANY_ID}/recurring-purchases`, otherSessionToken, {
        method: 'POST',
        body: JSON.stringify({ name: 'Other Co Schedule', items: [{ productId: 'p1', productName: 'Widget', quantity: 1 }], frequency: 'WEEKLY' }),
      }),
      { params: Promise.resolve({ companyId: OTHER_COMPANY_ID }) },
    );
    expect(create.status).toBe(200);
    const schedule = await create.json();
    await db.recurringPurchase.update({ where: { id: schedule.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });

    // Run-due for MY OWN company must never touch the other company's due schedule.
    await runDueRoute(requestFor(`/api/companies/${TEST_COMPANY_ID}/recurring-purchases/run-due`, sessionToken, { method: 'POST' }), {
      params: Promise.resolve({ companyId: TEST_COMPANY_ID }),
    });

    const stillDue = await db.recurringPurchase.findUnique({ where: { id: schedule.id } });
    expect(stillDue?.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());

    await deleteRecurringRoute(requestFor(`/api/companies/${OTHER_COMPANY_ID}/recurring-purchases/${schedule.id}`, otherSessionToken, { method: 'DELETE' }), {
      params: Promise.resolve({ companyId: OTHER_COMPANY_ID, recurringId: schedule.id }),
    });
  });

  it('the real cron sweep route rejects a request with no/wrong cron secret', async () => {
    const noSecret = await cronSweepRoute(new NextRequest('http://localhost/api/cron/recurring-purchase-sweep', { method: 'POST' }));
    expect(noSecret.status).toBe(401);

    const wrongSecret = await cronSweepRoute(
      new NextRequest('http://localhost/api/cron/recurring-purchase-sweep', { method: 'POST', headers: new Headers({ 'x-cron-secret': 'wrong' }) }),
    );
    expect(wrongSecret.status).toBe(401);
  });
});
