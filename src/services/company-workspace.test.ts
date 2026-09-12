import { beforeEach, describe, expect, it } from 'vitest';
import { companyService } from './company.service';
import { Role } from '@/config/rbac';

const OWNER_TENANT = { companyId: 'company-acme-gh' };
const OTHER_TENANT = { companyId: 'company-not-mine' };

/** Phase 10 regression suite - company workspace expansion (branches, departments, cost
 *  centers, profile editing). Every mutation here is gated the same way Phase 9 established:
 *  SETTINGS_MANAGE for the role, ownsRecord for the tenant, both required. */
beforeEach(() => {
  window.localStorage.clear();
});

describe('Company profile', () => {
  it('lets an owner update their own company profile', async () => {
    const result = await companyService.updateCompanyProfile('company-acme-gh', { industry: 'Logistics' }, Role.OWNER, OWNER_TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.industry).toBe('Logistics');
  });

  it("refuses updating another company's profile", async () => {
    const result = await companyService.updateCompanyProfile('company-acme-gh', { industry: 'Hijacked' }, Role.OWNER, OTHER_TENANT);
    expect(result.ok).toBe(false);
  });

  it('refuses a role without SETTINGS_MANAGE', async () => {
    const result = await companyService.updateCompanyProfile('company-acme-gh', { industry: 'X' }, Role.EMPLOYEE, OWNER_TENANT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('Departments', () => {
  it('creates and lists a department scoped to the company', async () => {
    await companyService.createDepartment('company-acme-gh', 'Logistics', Role.OWNER, OWNER_TENANT);
    const result = await companyService.listDepartments('company-acme-gh');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.some((d) => d.name === 'Logistics')).toBe(true);
  });

  it('removes a department', async () => {
    const created = await companyService.createDepartment('company-acme-gh', 'Temporary', Role.OWNER, OWNER_TENANT);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await companyService.removeDepartment(created.data.id, Role.OWNER, OWNER_TENANT);
    const result = await companyService.listDepartments('company-acme-gh');
    expect(result.ok && result.data.some((d) => d.id === created.data.id)).toBe(false);
  });

  it("refuses removing another company's department", async () => {
    const result = await companyService.removeDepartment('dept-it', Role.OWNER, OTHER_TENANT);
    expect(result.ok).toBe(false);
  });
});

describe('Cost centers', () => {
  it('creates a cost center linked to a department', async () => {
    const result = await companyService.createCostCenter('company-acme-gh', 'IT-005', 'New IT project', 'dept-it', Role.OWNER, OWNER_TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.departmentId).toBe('dept-it');
  });

  it("refuses creating a cost center for another company", async () => {
    const result = await companyService.createCostCenter('company-acme-gh', 'X-1', 'x', undefined, Role.OWNER, OTHER_TENANT);
    expect(result.ok).toBe(false);
  });
});

describe('Branches', () => {
  it('lists the seeded head office and Tema branch for Acme Ghana', async () => {
    const result = await companyService.listBranches('company-acme-gh');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.some((b) => b.isHeadOffice)).toBe(true);
      expect(result.data.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('creates a new branch', async () => {
    const result = await companyService.createBranch(
      { companyId: 'company-acme-gh', name: 'Kumasi Office', addressId: 'addr-acme-gh-accra', isWarehouse: false },
      Role.OWNER,
      OWNER_TENANT,
    );
    expect(result.ok).toBe(true);
  });

  it('refuses removing the head office branch', async () => {
    const result = await companyService.removeBranch('branch-acme-gh-hq', Role.OWNER, OWNER_TENANT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATE');
  });

  it("refuses creating a branch for another company", async () => {
    const result = await companyService.createBranch(
      { companyId: 'company-acme-gh', name: 'x', addressId: 'addr-acme-gh-accra', isWarehouse: false },
      Role.OWNER,
      OTHER_TENANT,
    );
    expect(result.ok).toBe(false);
  });
});
