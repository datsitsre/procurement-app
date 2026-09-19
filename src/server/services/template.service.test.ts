// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { createTemplate, listTemplates, removeTemplate } from './template.service';

/**
 * Phase 15 - real, database-backed regression suite for purchase templates. Runs against the
 * actual dev Postgres database, scoped to a dedicated test company this suite creates and cleans
 * up in `afterAll`.
 */

const TEST_COMPANY_ID = `test-company-template-${Date.now()}`;
const OTHER_COMPANY_ID = `test-company-template-other-${Date.now()}`;
const TEST_USER_ID = 'user-john-doe';
const ACTOR = { id: TEST_USER_ID, name: 'John Doe' };

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Template Test Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({ data: { id: OTHER_COMPANY_ID, name: 'Template Test Other Co', country: 'GH', currency: 'GHS' } });
});

afterAll(async () => {
  await db.purchaseTemplateItem.deleteMany({ where: { template: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } } });
  await db.purchaseTemplate.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, OTHER_COMPANY_ID] } } });
  await db.company.delete({ where: { id: OTHER_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('createTemplate', () => {
  it('rejects an empty name', async () => {
    const result = await createTemplate(
      { companyId: TEST_COMPANY_ID, name: '  ', items: [{ productId: 'p1', productName: 'Widget', quantity: 1 }], createdByUserId: TEST_USER_ID },
      ACTOR,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it('rejects a template with no items', async () => {
    const result = await createTemplate({ companyId: TEST_COMPANY_ID, name: 'Empty', items: [], createdByUserId: TEST_USER_ID }, ACTOR);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it('stores no price on any item - only productId/productName/quantity', async () => {
    const created = await createTemplate(
      {
        companyId: TEST_COMPANY_ID,
        name: 'Office Setup Package',
        items: [{ productId: 'p1', productName: 'Desk', quantity: 2 }],
        createdByUserId: TEST_USER_ID,
      },
      ACTOR,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.items[0]).toEqual({ productId: 'p1', productName: 'Desk', quantity: 2 });
    expect(JSON.stringify(created.data)).not.toMatch(/price/i);
  });
});

describe('listTemplates / removeTemplate - tenant isolation', () => {
  it("only lists a company's own templates, and refuses removing another company's template", async () => {
    const mine = await createTemplate({ companyId: TEST_COMPANY_ID, name: 'Mine', items: [{ productId: 'p1', productName: 'Widget', quantity: 1 }], createdByUserId: TEST_USER_ID }, ACTOR);
    const theirs = await createTemplate({ companyId: OTHER_COMPANY_ID, name: 'Theirs', items: [{ productId: 'p2', productName: 'Gadget', quantity: 1 }], createdByUserId: TEST_USER_ID }, ACTOR);
    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;

    const list = await listTemplates(TEST_COMPANY_ID);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.some((t) => t.id === mine.data.id)).toBe(true);
      expect(list.data.some((t) => t.id === theirs.data.id)).toBe(false);
    }

    // Cross-tenant removal attempt - the caller's own companyId doesn't own this template.
    const wrongCompany = await removeTemplate(theirs.data.id, TEST_COMPANY_ID, ACTOR);
    expect(wrongCompany.ok).toBe(false);
    if (!wrongCompany.ok) expect(wrongCompany.error.code).toBe('NOT_FOUND');

    // Still there - the cross-tenant attempt had no effect.
    const theirsStillThere = await listTemplates(OTHER_COMPANY_ID);
    if (theirsStillThere.ok) expect(theirsStillThere.data.some((t) => t.id === theirs.data.id)).toBe(true);

    const removed = await removeTemplate(mine.data.id, TEST_COMPANY_ID, ACTOR);
    expect(removed.ok).toBe(true);
    await removeTemplate(theirs.data.id, OTHER_COMPANY_ID, ACTOR);
  });
});
