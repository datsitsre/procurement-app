// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  addTeamMember,
  createBranch,
  createCostCenter,
  createDepartment,
  getCompanyProfile,
  getEffectiveSpendingLimit,
  listBranches,
  listSpendingLimits,
  listTeamMembers,
  removeBranch,
  removeCostCenter,
  removeDepartment,
  setSpendingLimit,
  updateCompanyProfile,
  updateTeamMember,
} from './company.service';

/**
 * Phase 14, Stage 3 - real, database-backed regression suite for the company workspace domain
 * (profile, departments, cost centers, branches). Runs against the actual dev Postgres database
 * (DATABASE_URL from .env, loaded into process.env by vitest.config.ts) rather than a mock, so
 * this exercises the real Prisma queries these routes execute. Everything it creates is scoped
 * to one dedicated test company and cleaned up in `afterAll` - it never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-service-${Date.now()}`;
const TEST_COMPANY_2_ID = `test-company-service-2-${Date.now()}`;
const TEST_SUPPLIER_COMPANY_ID = `test-supplier-company-service-${Date.now()}`;
const NEW_USER_EMAIL = `new-team-member-${Date.now()}@example.test`;

beforeAll(async () => {
  await db.company.create({
    data: { id: TEST_COMPANY_ID, name: 'Company Service Test Co', country: 'GH', currency: 'GHS', isBuyer: true },
  });
  await db.company.create({
    data: { id: TEST_COMPANY_2_ID, name: 'Company Service Test Co 2', country: 'GH', currency: 'GHS', isBuyer: true },
  });
  await db.company.create({
    data: { id: TEST_SUPPLIER_COMPANY_ID, name: 'Company Service Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
});

afterAll(async () => {
  await db.companyMembership.deleteMany({ where: { companyId: { in: [TEST_COMPANY_ID, TEST_COMPANY_2_ID, TEST_SUPPLIER_COMPANY_ID] } } });
  await db.user.deleteMany({ where: { email: NEW_USER_EMAIL } });
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_2_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_SUPPLIER_COMPANY_ID } }).catch(() => undefined);
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

describe('Spending limits (Phase 14, Stage 6)', () => {
  it('falls back to the platform default when no company override exists', async () => {
    const { DefaultSpendingLimits } = await import('@/config/spending-limits');
    const limit = await getEffectiveSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE');
    expect(limit).toBe(DefaultSpendingLimits.EMPLOYEE);
  });

  it("rejects setting a negative limit, then a company override takes effect and shows up in the list", async () => {
    const negative = await setSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE', -1);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error.code).toBe('INVALID_AMOUNT');

    const set = await setSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE', 12345);
    expect(set.ok).toBe(true);
    expect(await getEffectiveSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE')).toBe(12345);

    const list = await listSpendingLimits(TEST_COMPANY_ID);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.find((l) => l.role === 'EMPLOYEE')?.amount).toBe(12345);

    // Setting it again for the same role updates in place rather than creating a duplicate row.
    await setSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE', 5);
    expect(await getEffectiveSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE')).toBe(5);
    const rows = await db.spendingLimit.findMany({ where: { companyId: TEST_COMPANY_ID, role: 'EMPLOYEE' } });
    expect(rows).toHaveLength(1);
  });
});

describe('addTeamMember', () => {
  it('creates a brand-new account with a real, usable temporary password when the email has none yet', async () => {
    const result = await addTeamMember(TEST_COMPANY_ID, { email: NEW_USER_EMAIL, name: 'New Person', role: 'EMPLOYEE' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.user.email).toBe(NEW_USER_EMAIL);
    expect(result.data.membership.role).toBe('EMPLOYEE');
    expect(result.data.membership.status).toBe('ACTIVE');
    expect(result.data.temporaryPassword).toBeTruthy();

    const { verifyPassword } = await import('@/server/auth/password');
    const user = await db.user.findUnique({ where: { email: NEW_USER_EMAIL } });
    expect(user).not.toBeNull();
    // The stored hash actually verifies against the plaintext password just handed back - not
    // just present, but really the password this account can log in with.
    expect(await verifyPassword(result.data.temporaryPassword!, user!.passwordHash)).toBe(true);
  });

  it('rejects a missing name for a genuinely new email - there is no account to fall back to', async () => {
    const result = await addTeamMember(TEST_COMPANY_ID, { email: `no-name-${Date.now()}@example.test`, role: 'EMPLOYEE' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NAME_REQUIRED');
  });

  it('adds an existing account as a new membership at a different company instead of creating a duplicate user, with no temporary password', async () => {
    const result = await addTeamMember(TEST_COMPANY_2_ID, { email: NEW_USER_EMAIL, role: 'FINANCE_MANAGER' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.temporaryPassword).toBeUndefined();

    const users = await db.user.findMany({ where: { email: NEW_USER_EMAIL } });
    expect(users).toHaveLength(1); // still just the one account from the first test
  });

  it('refuses adding someone already a member of this company', async () => {
    const result = await addTeamMember(TEST_COMPANY_ID, { email: NEW_USER_EMAIL, role: 'EMPLOYEE' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_MEMBER');
  });

  it("refuses a role that doesn't belong to this company's side of the marketplace - never lets USERS_MANAGE at a buyer company hand out SUPPLIER_ADMIN or PLATFORM_ADMIN", async () => {
    const supplierRoleAtBuyer = await addTeamMember(TEST_COMPANY_ID, { email: `x-${Date.now()}@example.test`, name: 'X', role: 'SUPPLIER_ADMIN' });
    expect(supplierRoleAtBuyer.ok).toBe(false);
    if (!supplierRoleAtBuyer.ok) expect(supplierRoleAtBuyer.error.code).toBe('INVALID_ROLE');

    const platformRoleAtBuyer = await addTeamMember(TEST_COMPANY_ID, { email: `y-${Date.now()}@example.test`, name: 'Y', role: 'PLATFORM_ADMIN' });
    expect(platformRoleAtBuyer.ok).toBe(false);
    if (!platformRoleAtBuyer.ok) expect(platformRoleAtBuyer.error.code).toBe('INVALID_ROLE');

    const buyerRoleAtSupplier = await addTeamMember(TEST_SUPPLIER_COMPANY_ID, { email: `z-${Date.now()}@example.test`, name: 'Z', role: 'OWNER' });
    expect(buyerRoleAtSupplier.ok).toBe(false);
    if (!buyerRoleAtSupplier.ok) expect(buyerRoleAtSupplier.error.code).toBe('INVALID_ROLE');
  });

  it('shows up in listTeamMembers afterward', async () => {
    const list = await listTeamMembers(TEST_COMPANY_ID);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.some((m) => m.user.email === NEW_USER_EMAIL)).toBe(true);
  });
});

describe('updateTeamMember', () => {
  it("edits an existing member's role/department and their own name/avatar together", async () => {
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const user = await db.user.findUniqueOrThrow({ where: { email: NEW_USER_EMAIL } });
    const result = await updateTeamMember(TEST_COMPANY_ID, user.id, {
      role: 'FINANCE_MANAGER',
      department: 'Finance',
      name: 'Edited Name',
      avatarUrl: avatar,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.membership.role).toBe('FINANCE_MANAGER');
    expect(result.data.membership.department).toBe('Finance');
    expect(result.data.user.name).toBe('Edited Name');
    expect(result.data.user.avatarUrl).toBe(avatar);
  });

  it('returns NOT_FOUND for a userId not actually a member of this company', async () => {
    const result = await updateTeamMember(TEST_COMPANY_ID, 'user-does-not-exist', { role: 'EMPLOYEE' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it("refuses moving a member to a role outside this company's own workspace", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: NEW_USER_EMAIL } });
    const result = await updateTeamMember(TEST_COMPANY_ID, user.id, { role: 'SUPPLIER_ADMIN' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_ROLE');
  });

  it('rejects clearing the name to empty', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { email: NEW_USER_EMAIL } });
    const result = await updateTeamMember(TEST_COMPANY_ID, user.id, { name: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_NAME');
  });
});
