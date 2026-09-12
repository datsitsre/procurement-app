import { assertPermission, delay, fail, ok } from './base';
import { demoPurchaseRequests, demoRfqs } from '@/lib/demo-data/procurement';
import type { ServiceResult, UUID } from '@/types/common';
import type { PurchaseRequest, RFQ } from '@/types/procurement';
import { Permission, RoleLabels, type Role } from '@/config/rbac';

const PR_OVERRIDES_KEY = 'procurement.purchase-requests.v1';

/** Approval-step decisions made at runtime are persisted as an override list keyed by
 *  purchase-request id, merged over the static seed data on read - the same "seed + runtime
 *  overrides" pattern as auth.service.ts's runtime companies/users, so a page reload doesn't
 *  silently revert an approval decision. */
function readOverrides(): Record<UUID, PurchaseRequest> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(PR_OVERRIDES_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, PurchaseRequest>;
  } catch {
    return {};
  }
}

function writeOverride(pr: PurchaseRequest) {
  if (typeof window === 'undefined') return;
  const overrides = readOverrides();
  overrides[pr.id] = pr;
  window.localStorage.setItem(PR_OVERRIDES_KEY, JSON.stringify(overrides));
}

function allPurchaseRequests(): PurchaseRequest[] {
  const overrides = readOverrides();
  return demoPurchaseRequests.map((pr) => overrides[pr.id] ?? pr);
}

export interface ProcurementService {
  listRfqs(companyId: UUID): Promise<ServiceResult<RFQ[]>>;
  listPurchaseRequests(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>>;
  /** Purchase requests with a step still PENDING for this exact role - the read-model behind
   *  the Approvals page and the dashboard's "pending approvals" count. */
  listPendingApprovals(companyId: UUID, role: Role): Promise<ServiceResult<PurchaseRequest[]>>;
  decideStep(purchaseRequestId: UUID, callerRole: Role, decision: 'APPROVED' | 'REJECTED', comment?: string): Promise<ServiceResult<PurchaseRequest>>;
}

class MockProcurementService implements ProcurementService {
  async listRfqs(companyId: UUID): Promise<ServiceResult<RFQ[]>> {
    await delay(250);
    return ok(demoRfqs.filter((r) => r.companyId === companyId));
  }

  async listPurchaseRequests(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>> {
    await delay(250);
    return ok(allPurchaseRequests().filter((pr) => pr.companyId === companyId));
  }

  async listPendingApprovals(companyId: UUID, role: Role): Promise<ServiceResult<PurchaseRequest[]>> {
    await delay(250);
    const pending = allPurchaseRequests().filter(
      (pr) =>
        pr.companyId === companyId &&
        pr.status === 'IN_APPROVAL' &&
        pr.approvalSteps.some((s) => s.status === 'PENDING' && s.approverRole === role),
    );
    return ok(pending);
  }

  async decideStep(
    purchaseRequestId: UUID,
    callerRole: Role,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ): Promise<ServiceResult<PurchaseRequest>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_APPROVE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const pr = allPurchaseRequests().find((p) => p.id === purchaseRequestId);
    if (!pr) return fail('NOT_FOUND', 'That purchase request could not be found.');

    const stepIndex = pr.approvalSteps.findIndex((s) => s.status === 'PENDING');
    const step = pr.approvalSteps[stepIndex];
    if (!step || step.approverRole !== callerRole) {
      return fail(
        'WRONG_APPROVER',
        `This request is waiting on ${step ? RoleLabels[step.approverRole as Role] ?? step.approverRole : 'no one'}, not your role.`,
      );
    }

    const updatedSteps = pr.approvalSteps.map((s, i) =>
      i === stepIndex ? { ...s, status: decision, decidedAt: new Date().toISOString(), comment } : s,
    );

    let status = pr.status;
    if (decision === 'REJECTED') {
      status = 'REJECTED';
    } else if (updatedSteps.every((s) => s.status === 'APPROVED')) {
      status = 'APPROVED';
    }

    const next: PurchaseRequest = { ...pr, approvalSteps: updatedSteps, status };
    writeOverride(next);
    return ok(next);
  }
}

export const procurementService: ProcurementService = new MockProcurementService();
