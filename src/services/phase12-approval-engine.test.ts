import { beforeEach, describe, expect, it } from 'vitest';
import { procurementService } from './procurement.service';
import { Role } from '@/config/rbac';

/**
 * Phase 12 (Advanced Approval Engine) regression suite. Covers the gaps this phase closed:
 * - Approval rules (spend bands + required approver roles) are now admin-configurable, with the
 *   same authorization/tenant-isolation guarantees as every other settings mutation.
 * - Rejecting a step now requires a reason (enforced in the service layer, not just the UI -
 *   section 9.1's "the service layer is the security boundary" applies to business rules too).
 * - The approver's name is now actually recorded on the decided step (previously accepted as a
 *   parameter and silently dropped).
 */

const MY_COMPANY = { companyId: 'company-acme-gh' };
const OTHER_COMPANY = { companyId: 'company-not-mine' };
const REAL_PR_ID = 'pr-10082'; // company-acme-gh, single pending step: FINANCE_MANAGER

// A company with no seeded approval rules (the seed data's three rules for company-acme-gh
// already span 0 to infinity with no gaps, so any new rule there necessarily overlaps one of
// them) - used by the tests below that actually need room to add a fresh rule.
const FRESH_COMPANY = { companyId: 'company-fresh-test' };

beforeEach(() => {
  window.localStorage.clear();
});

describe('decideStep (section 12 - reject reason + approver name)', () => {
  it('refuses to reject a step with no comment', async () => {
    const result = await procurementService.decideStep(REAL_PR_ID, Role.FINANCE_MANAGER, 'REJECTED', MY_COMPANY, undefined, 'Sarah Smith');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REASON_REQUIRED');
  });

  it('refuses to reject a step with a blank/whitespace-only comment', async () => {
    const result = await procurementService.decideStep(REAL_PR_ID, Role.FINANCE_MANAGER, 'REJECTED', MY_COMPANY, '   ', 'Sarah Smith');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REASON_REQUIRED');
  });

  it('accepts a rejection once a reason is given, and records it on the step', async () => {
    const result = await procurementService.decideStep(
      REAL_PR_ID,
      Role.FINANCE_MANAGER,
      'REJECTED',
      MY_COMPANY,
      'Over budget for this quarter',
      'Sarah Smith',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('REJECTED');
      const step = result.data.approvalSteps.find((s) => s.approverRole === 'FINANCE_MANAGER');
      expect(step?.comment).toBe('Over budget for this quarter');
      expect(step?.approverName).toBe('Sarah Smith');
    }
  });

  it('does not require a comment to approve, but still records the approver name when given', async () => {
    const result = await procurementService.decideStep(REAL_PR_ID, Role.FINANCE_MANAGER, 'APPROVED', MY_COMPANY, undefined, 'Sarah Smith');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const step = result.data.approvalSteps.find((s) => s.approverRole === 'FINANCE_MANAGER');
      expect(step?.approverName).toBe('Sarah Smith');
      expect(step?.comment).toBeUndefined();
    }
  });
});

describe('Approval rules (section 12 - admin-configurable spend bands)', () => {
  it('creates and lists a rule scoped to the company', async () => {
    const created = await procurementService.createApprovalRule(
      { companyId: 'company-fresh-test', minAmount: 200000, maxAmount: undefined, requiredApproverRoles: ['OWNER'] },
      Role.OWNER,
      FRESH_COMPANY,
    );
    expect(created.ok).toBe(true);

    const list = await procurementService.listApprovalRules('company-fresh-test');
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.some((r) => r.minAmount === 200000)).toBe(true);
  });

  it('refuses a role without settings.manage from creating a rule', async () => {
    const result = await procurementService.createApprovalRule(
      { companyId: 'company-acme-gh', minAmount: 200000, requiredApproverRoles: ['OWNER'] },
      Role.EMPLOYEE,
      MY_COMPANY,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses creating a rule for another company", async () => {
    const result = await procurementService.createApprovalRule(
      { companyId: 'company-acme-gh', minAmount: 200000, requiredApproverRoles: ['OWNER'] },
      Role.OWNER,
      OTHER_COMPANY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('refuses a rule whose max is not greater than its min', async () => {
    const result = await procurementService.createApprovalRule(
      { companyId: 'company-acme-gh', minAmount: 10000, maxAmount: 5000, requiredApproverRoles: ['OWNER'] },
      Role.OWNER,
      MY_COMPANY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_RANGE');
  });

  it('refuses a rule with no approver roles', async () => {
    const result = await procurementService.createApprovalRule(
      { companyId: 'company-acme-gh', minAmount: 200000, requiredApproverRoles: [] },
      Role.OWNER,
      MY_COMPANY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it('refuses naming a role that cannot approve purchase requests (would strand the request)', async () => {
    const result = await procurementService.createApprovalRule(
      { companyId: 'company-acme-gh', minAmount: 200000, requiredApproverRoles: ['EMPLOYEE'] },
      Role.OWNER,
      MY_COMPANY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_CANNOT_APPROVE');
  });

  it('refuses a rule whose range overlaps an existing rule for the same company', async () => {
    // The seed data already has a rule covering 0-5000 for company-acme-gh.
    const result = await procurementService.createApprovalRule(
      { companyId: 'company-acme-gh', minAmount: 2000, maxAmount: 8000, requiredApproverRoles: ['OWNER'] },
      Role.OWNER,
      MY_COMPANY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('OVERLAPPING_RANGE');
  });

  it("refuses removing another company's rule", async () => {
    const created = await procurementService.createApprovalRule(
      { companyId: 'company-fresh-test', minAmount: 300000, requiredApproverRoles: ['OWNER'] },
      Role.OWNER,
      FRESH_COMPANY,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const removed = await procurementService.removeApprovalRule(created.data.id, Role.OWNER, OTHER_COMPANY);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('NOT_FOUND');

    const removedByOwner = await procurementService.removeApprovalRule(created.data.id, Role.OWNER, FRESH_COMPANY);
    expect(removedByOwner.ok).toBe(true);
  });

  it('a newly created rule actually governs which roles must approve a request in its band', async () => {
    const created = await procurementService.createApprovalRule(
      { companyId: 'company-fresh-test', minAmount: 900000, requiredApproverRoles: ['OWNER'] },
      Role.OWNER,
      FRESH_COMPANY,
    );
    expect(created.ok).toBe(true);

    const pr = await procurementService.createPurchaseRequest(
      {
        companyId: 'company-fresh-test',
        requesterUserId: 'user-1',
        requesterName: 'Test Buyer',
        items: [
          {
            id: 'pri-huge',
            productId: 'prod-cisco-switch',
            productName: 'Cisco switch',
            supplierId: 'supplier-abc',
            supplierName: 'ABC',
            quantity: 200,
            unitPrice: 5000,
          },
        ],
        reason: 'Large rollout',
      },
      Role.OWNER, // OWNER has no spending limit, so this large total isn't blocked by section 11.5
    );
    expect(pr.ok).toBe(true);
    if (pr.ok) {
      expect(pr.data.approvalSteps).toHaveLength(1);
      expect(pr.data.approvalSteps[0].approverRole).toBe('OWNER');
    }
  });
});
