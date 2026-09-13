// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  createBranch,
  createCostCenter,
  createDepartment,
  getCompanyProfile,
  listBranches,
  removeBranch,
  removeCostCenter,
  removeDepartment,
  updateCompanyProfile,
} from './company.service';

/**
 * Phase 14, Stage 3 - real, database-backed regression suite for the company workspace domain
 * (profile, departments, cost centers, branches). Runs against the actual dev Postgres database
 * (DATABASE_URL from .env, loaded into process.env by vitest.config.ts) rather than a mock, so
 * this exercises the real Prisma queries these routes execute. Everything it creates is scoped
 * to one dedicated test company and cleaned up in `afterAll` - it never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-service-${Date.now()}`;

beforeAll(async () => {
  await db.company.create({
    data: { id: TEST_COMPANY_ID, name: 'Company Service Test Co', country: 'GH', currency: 'GHS', isBuyer: true },
  });
});

afterAll(async () => {
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('Company profile', () => {
  it('reads and updates a profile', async () => {
    const before = await getCompanyProfile(TEST_COMPANY_ID);
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.data.industry).toBeUndefined();

    const updated = await updateCompanyProfile(TEST_COMPANY_ID, { industry: 'Logistics' });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.data.industry).toBe('Logistics');
  });

  it('returns NOT_FOUND for a company that does not exist', async () => {
    const result = await getCompanyProfile('company-does-not-exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('Departments', () => {
  it('creates and removes a department scoped to the company', async () => {
    const created = await createDepartment(TEST_COMPANY_ID, 'Logistics');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.companyId).toBe(TEST_COMPANY_ID);

    const removed = await removeDepartment(TEST_COMPANY_ID, created.data.id);
    expect(removed.ok).toBe(true);
  });

  it('rejects an empty name', async () => {
    const result = await createDepartment(TEST_COMPANY_ID, '   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it("refuses removing a department scoped to a different company (deleteMany's compound where enforces this)", async () => {
    const created = await createDepartment(TEST_COMPANY_ID, 'Only Mine');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const removed = await removeDepartment('company-not-mine', created.data.id);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('NOT_FOUND');

    // still there, since the wrong-company delete was a no-op
    const stillThere = await db.department.findUnique({ where: { id: created.data.id } });
    expect(stillThere).not.toBeNull();
    await removeDepartment(TEST_COMPANY_ID, created.data.id);
  });
});

describe('Cost centers', () => {
  it('refuses a duplicate code within the same company', async () => {
    const first = await createCostCenter(TEST_COMPANY_ID, 'DUP-1', 'First', undefined);
    expect(first.ok).toBe(true);

    const second = await createCostCenter(TEST_COMPANY_ID, 'DUP-1', 'Second', undefined);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('DUPLICATE_CODE');

    if (first.ok) await removeCostCenter(TEST_COMPANY_ID, first.data.id);
  });
});

describe('Branches', () => {
  it('creates a branch and refuses removing it if it is the head office', async () => {
    const created = await createBranch(TEST_COMPANY_ID, {
      name: 'Test Branch',
      addressId: 'addr-does-not-need-to-exist-for-this-test',
      isWarehouse: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Simulate a head office (no API mutation sets this flag yet - only seed data does).
    await db.branch.update({ where: { id: created.data.id }, data: { isHeadOffice: true } });
    const removed = await removeBranch(TEST_COMPANY_ID, created.data.id);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('INVALID_STATE');

    await db.branch.delete({ where: { id: created.data.id } });
  });

  it('lists only branches belonging to the requested company', async () => {
    const result = await listBranches(TEST_COMPANY_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.every((b) => b.companyId === TEST_COMPANY_ID)).toBe(true);
  });
});
