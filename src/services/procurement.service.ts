import { apiRequest, assertPermission, delay, fail, ok, ownsRecord } from './base';
import { FLAT_DELIVERY_FEE, calculateTax } from '@/utils/pricing';
import { demoApprovalRules, demoPurchaseRequests } from '@/lib/demo-data/procurement';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type {
  ApprovalRule,
  ApprovalStep,
  NegotiationMessage,
  PurchaseRequest,
  PurchaseRequestItem,
  Quote,
  RFQ,
  RFQItem,
} from '@/types/procurement';
import { hasPermission, Permission, RoleLabels, type Role } from '@/config/rbac';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

// ---------- runtime persistence (seed + localStorage overrides, same pattern as auth.service) ----------

const PR_STORE_KEY = 'procurement.purchase-requests.v1';

function readStore<T>(key: string): Record<UUID, T> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, T>;
  } catch {
    return {};
  }
}

function writeStore<T>(key: string, id: UUID, value: T) {
  if (typeof window === 'undefined') return;
  const store = readStore<T>(key);
  store[id] = value;
  window.localStorage.setItem(key, JSON.stringify(store));
}

function readList<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(`${key}.list`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function appendToList<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  const list = readList<T>(key);
  list.push(value);
  window.localStorage.setItem(`${key}.list`, JSON.stringify(list));
}

function allPurchaseRequests(): PurchaseRequest[] {
  const overrides = readStore<PurchaseRequest>(PR_STORE_KEY);
  const seeded = demoPurchaseRequests.map((pr) => overrides[pr.id] ?? pr);
  const created = readList<PurchaseRequest>(PR_STORE_KEY).map((pr) => overrides[pr.id] ?? pr);
  return [...seeded, ...created];
}

// ---------- approval rule resolution (section 23) ----------

// ---------- approval rules (section 12 - admin-configurable spend bands) ----------

const RULE_STORE_KEY = 'procurement.approval-rules.v1';
const RULE_REMOVED_KEY = 'procurement.approval-rules.v1.removed';

function readRuleRemoved(): Set<UUID> {
  if (typeof window === 'undefined') return new Set();
  const raw = window.localStorage.getItem(RULE_REMOVED_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as UUID[]);
  } catch {
    return new Set();
  }
}

function markRuleRemoved(id: UUID) {
  if (typeof window === 'undefined') return;
  const removed = readRuleRemoved();
  removed.add(id);
  window.localStorage.setItem(RULE_REMOVED_KEY, JSON.stringify(Array.from(removed)));
}

/** Every approval rule for every company (seeded + admin-created), minus anything removed -
 *  the same seed+override pattern every other mock service in this app uses. There's no
 *  separate "edit" path yet, only add/remove - editing a band is remove-then-recreate. */
function allApprovalRules(): ApprovalRule[] {
  const removed = readRuleRemoved();
  return [...demoApprovalRules, ...readList<ApprovalRule>(RULE_STORE_KEY)].filter((r) => !removed.has(r.id));
}

/** Resolves which roles must approve a purchase request of a given amount, per the company's
 *  configured spend bands, and turns that into an ordered list of pending approval steps. A
 *  company with no matching band (or no rules at all) falls back to a single OWNER approval
 *  step, so a request is never silently left with nothing to gate it. */
function resolveApprovalSteps(companyId: UUID, amount: number): ApprovalStep[] {
  const rule = allApprovalRules()
    .filter((r) => r.companyId === companyId)
    .find((r) => amount >= r.minAmount && (r.maxAmount === undefined || amount <= r.maxAmount));

  const roles = rule?.requiredApproverRoles ?? ['OWNER'];
  return roles.map((role, index) => ({
    id: newId('as'),
    stepOrder: index + 1,
    approverRole: role,
    status: 'PENDING' as const,
  }));
}

// ---------- public interface ----------

export interface CreatePurchaseRequestInput {
  companyId: UUID;
  requesterUserId: UUID;
  requesterName: string;
  department?: string;
  costCenterId?: UUID;
  items: PurchaseRequestItem[];
  reason: string;
}

export interface NewApprovalRuleInput {
  companyId: UUID;
  minAmount: number;
  maxAmount?: number;
  requiredApproverRoles: string[];
}

export interface CreateRfqInput {
  companyId: UUID;
  createdByUserId: UUID;
  items: RFQItem[];
  requiredDeliveryDate: string;
  deliveryLocation: string;
  additionalRequirements?: string;
  supplierIds: UUID[];
}

export interface SubmitQuoteInput {
  rfqId: UUID;
  supplierId: UUID;
  items: { productId: UUID; quantity: number; unitPrice: number }[];
  deliveryDays: number;
  warrantyMonths: number;
  notes?: string;
}

export interface ProcurementService {
  listRfqs(companyId: UUID): Promise<ServiceResult<RFQ[]>>;
  /** RFQs a supplier has been invited to respond to (section 18/44) - the supplier-workspace
   *  counterpart to `listRfqs`, which is keyed by the *buyer's* company id instead. */
  listRfqsForSupplier(supplierId: UUID): Promise<ServiceResult<RFQ[]>>;
  /** Fetched by a URL path segment (section 9.2) - `caller` must be the buying company, an
   *  invited supplier, or a platform admin, or this returns NOT_FOUND rather than leaking
   *  another tenant's RFQ (pricing, requirements, negotiation history). */
  getRfq(id: UUID, caller: TenantContext): Promise<ServiceResult<RFQ>>;
  createRfq(input: CreateRfqInput, callerRole: Role): Promise<ServiceResult<RFQ>>;
  listQuotesForRfq(rfqId: UUID): Promise<ServiceResult<Quote[]>>;
  /** Every quote a supplier has ever submitted, across every RFQ - analytics' RFQ win-rate
   *  reads this (section 45/63), joined against each RFQ's `acceptedQuoteId` to know which
   *  quotes actually won rather than assuming "RFQ status ACCEPTED" means this supplier won. */
  listQuotesForSupplier(supplierId: UUID): Promise<ServiceResult<Quote[]>>;
  /** A supplier's response to an RFQ (section 19) - marks their invitation QUOTED and moves
   *  the RFQ out of SENT/VIEWED once at least one quote exists. */
  submitQuote(input: SubmitQuoteInput, callerRole: Role): Promise<ServiceResult<Quote>>;
  listNegotiationMessages(rfqId: UUID, quoteId: UUID): Promise<ServiceResult<NegotiationMessage[]>>;
  sendNegotiationMessage(
    rfqId: UUID,
    quoteId: UUID,
    message: string,
    callerRole: Role,
    proposedPrice?: number,
    proposedQuantity?: number,
  ): Promise<ServiceResult<NegotiationMessage[]>>;
  acceptQuote(
    rfqId: UUID,
    quoteId: UUID,
    authorizedByName: string,
    callerRole: Role,
    caller: TenantContext,
  ): Promise<ServiceResult<{ purchaseOrderId: UUID }>>;

  listPurchaseRequests(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>>;
  /** Fetched by a URL path segment (section 9.2) - `caller` must belong to the request's own
   *  company or be a platform admin, or this returns NOT_FOUND rather than leaking another
   *  tenant's purchase request. */
  getPurchaseRequest(id: UUID, caller: TenantContext): Promise<ServiceResult<PurchaseRequest>>;
  createPurchaseRequest(input: CreatePurchaseRequestInput, callerRole: Role): Promise<ServiceResult<PurchaseRequest>>;
  listPendingApprovals(companyId: UUID, role: Role): Promise<ServiceResult<PurchaseRequest[]>>;
  /** Rejecting a step requires `comment` (enforced here, not just in the UI - section 9.1's
   *  "the service layer is the security boundary" applies just as much to a business rule like
   *  this as it does to authorization) so the requester always knows what to fix. `callerName`
   *  is recorded on the decided step so the approval timeline shows who actually acted, not
   *  just which role. */
  decideStep(
    purchaseRequestId: UUID,
    callerRole: Role,
    decision: 'APPROVED' | 'REJECTED',
    caller: TenantContext,
    comment?: string,
    callerName?: string,
  ): Promise<ServiceResult<PurchaseRequest>>;

  // ---- Approval rules (section 12 - admin-configurable spend bands) ----

  listApprovalRules(companyId: UUID): Promise<ServiceResult<ApprovalRule[]>>;
  createApprovalRule(input: NewApprovalRuleInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<ApprovalRule>>;
  removeApprovalRule(ruleId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
}

/**
 * Calls the real `/api/rfqs/*` and `/api/suppliers/[supplierId]/{rfqs,quotes}` backend (Phase
 * 14, Stage 5) for RFQs, quotes, and negotiation. `callerRole`/`caller` are still accepted on
 * several methods (every existing page already passes them) but are never sent over the wire
 * and never trusted for authorization - the API derives the caller's role and tenant from the
 * session cookie itself (server/auth/require.ts, server/services/procurement.service.ts).
 * Keeping these parameters means every consuming page needed zero changes. Purchase requests
 * and approval rules stay on the mock below (see that block's own comment).
 */
class ApiProcurementService implements ProcurementService {
  // ---- RFQ ----

  async listRfqs(companyId: UUID): Promise<ServiceResult<RFQ[]>> {
    return apiRequest<RFQ[]>(`/api/rfqs?companyId=${companyId}`);
  }

  async listRfqsForSupplier(supplierId: UUID): Promise<ServiceResult<RFQ[]>> {
    return apiRequest<RFQ[]>(`/api/suppliers/${supplierId}/rfqs`);
  }

  async getRfq(id: UUID): Promise<ServiceResult<RFQ>> {
    return apiRequest<RFQ>(`/api/rfqs/${id}`);
  }

  async createRfq(input: CreateRfqInput): Promise<ServiceResult<RFQ>> {
    return apiRequest<RFQ>('/api/rfqs', { method: 'POST', body: JSON.stringify(input) });
  }

  // ---- Quotes ----

  async listQuotesForRfq(rfqId: UUID): Promise<ServiceResult<Quote[]>> {
    return apiRequest<Quote[]>(`/api/rfqs/${rfqId}/quotes`);
  }

  async listQuotesForSupplier(supplierId: UUID): Promise<ServiceResult<Quote[]>> {
    return apiRequest<Quote[]>(`/api/suppliers/${supplierId}/quotes`);
  }

  async submitQuote(input: SubmitQuoteInput): Promise<ServiceResult<Quote>> {
    const { rfqId, ...body } = input;
    return apiRequest<Quote>(`/api/rfqs/${rfqId}/quotes`, { method: 'POST', body: JSON.stringify(body) });
  }

  // ---- Negotiation ----

  async listNegotiationMessages(rfqId: UUID, quoteId: UUID): Promise<ServiceResult<NegotiationMessage[]>> {
    return apiRequest<NegotiationMessage[]>(`/api/rfqs/${rfqId}/quotes/${quoteId}/negotiations`);
  }

  async sendNegotiationMessage(
    rfqId: UUID,
    quoteId: UUID,
    message: string,
    callerRole: Role,
    proposedPrice?: number,
    proposedQuantity?: number,
  ): Promise<ServiceResult<NegotiationMessage[]>> {
    return apiRequest<NegotiationMessage[]>(`/api/rfqs/${rfqId}/quotes/${quoteId}/negotiations`, {
      method: 'POST',
      body: JSON.stringify({ message, proposedPrice, proposedQuantity }),
    });
  }

  async acceptQuote(
    rfqId: UUID,
    quoteId: UUID,
    authorizedByName: string,
  ): Promise<ServiceResult<{ purchaseOrderId: UUID }>> {
    const result = await apiRequest<{ rfq: RFQ; quote: Quote }>(`/api/rfqs/${rfqId}/quotes/${quoteId}/accept`, { method: 'POST' });
    if (!result.ok) return result;

    // Building a PurchaseOrder from an accepted quote is still purchase-order.service's (mock)
    // job - the server only updates the RFQ/Quote side (see its own acceptQuote comment).
    // Imported lazily to avoid a circular import between the two service modules, the same
    // pattern the old mock acceptQuote used.
    const { purchaseOrderService } = await import('./purchase-order.service');
    const po = await purchaseOrderService.createFromQuote(result.data.rfq, result.data.quote, authorizedByName);
    return ok({ purchaseOrderId: po.id });
  }

  // ---- Purchase requests ----

  async listPurchaseRequests(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>> {
    await delay(250);
    return ok(allPurchaseRequests().filter((pr) => pr.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async getPurchaseRequest(id: UUID, caller: TenantContext): Promise<ServiceResult<PurchaseRequest>> {
    await delay(200);
    const pr = allPurchaseRequests().find((p) => p.id === id);
    if (!pr || !ownsRecord(caller, pr.companyId)) return fail('NOT_FOUND', 'That purchase request could not be found.');
    return ok(pr);
  }

  async createPurchaseRequest(input: CreatePurchaseRequestInput, callerRole: Role): Promise<ServiceResult<PurchaseRequest>> {
    await delay(400);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_CREATE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (input.items.length === 0) return fail('EMPTY', 'Your cart is empty.');

    // Matches the cart page's own total exactly (subtotal + tax + delivery) - the approval
    // rule bands in resolveApprovalSteps gate on what the company will actually pay, not just
    // the line-item subtotal, so this has to be computed the same way here as it was there.
    const subtotal = input.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const totalAmount = subtotal + calculateTax(subtotal) + FLAT_DELIVERY_FEE;

    // Spending limit (section 11.5) - a business rule layered on top of the permission check
    // above, never a replacement for it: PURCHASE_REQUEST_CREATE says this role may submit a
    // request at all, this says how large a single one from that role may be.
    const { spendingLimitFor } = await import('./company.service');
    const limit = spendingLimitFor(input.companyId, callerRole);
    if (limit !== undefined && totalAmount > limit) {
      return fail(
        'SPENDING_LIMIT_EXCEEDED',
        `This request totals ${totalAmount.toLocaleString()}, above your role's ${limit.toLocaleString()} limit per request. Ask someone with a higher limit to submit it, or split it into smaller requests.`,
      );
    }

    const pr: PurchaseRequest = {
      id: newId('pr'),
      reference: `PR-${Math.floor(10000 + Math.random() * 89999)}`,
      companyId: input.companyId,
      requesterUserId: input.requesterUserId,
      requesterName: input.requesterName,
      department: input.department,
      costCenterId: input.costCenterId,
      items: input.items,
      totalAmount,
      reason: input.reason,
      attachmentIds: [],
      approvalSteps: resolveApprovalSteps(input.companyId, totalAmount),
      status: 'IN_APPROVAL',
      createdAt: new Date().toISOString(),
    };
    appendToList(PR_STORE_KEY, pr);
    return ok(pr);
  }

  async listPendingApprovals(companyId: UUID, role: Role): Promise<ServiceResult<PurchaseRequest[]>> {
    await delay(250);
    // Only the *next* pending step (steps are sequential) matters - a later step waiting on
    // this role shouldn't surface before earlier steps are decided.
    const pending = allPurchaseRequests().filter((pr) => {
      if (pr.companyId !== companyId || pr.status !== 'IN_APPROVAL') return false;
      const nextStep = pr.approvalSteps.find((s) => s.status === 'PENDING');
      return nextStep?.approverRole === role;
    });
    return ok(pending);
  }

  async decideStep(
    purchaseRequestId: UUID,
    callerRole: Role,
    decision: 'APPROVED' | 'REJECTED',
    caller: TenantContext,
    comment?: string,
    callerName?: string,
  ): Promise<ServiceResult<PurchaseRequest>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_APPROVE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const pr = allPurchaseRequests().find((p) => p.id === purchaseRequestId);
    // Having PURCHASE_REQUEST_APPROVE and the right role for the pending step only proves this
    // caller can approve *some* company's requests - without this, a Finance Manager at any
    // company could approve or reject another company's purchase request outright (section 9.2).
    if (!pr || !ownsRecord(caller, pr.companyId)) return fail('NOT_FOUND', 'That purchase request could not be found.');

    const stepIndex = pr.approvalSteps.findIndex((s) => s.status === 'PENDING');
    const step = pr.approvalSteps[stepIndex];
    if (!step || step.approverRole !== callerRole) {
      return fail(
        'WRONG_APPROVER',
        `This request is waiting on ${step ? RoleLabels[step.approverRole as Role] ?? step.approverRole : 'no one'}, not your role.`,
      );
    }
    // A rejection must say why, so the requester has something to act on - checked here, not
    // just enforced by the Approvals page's form, per section 9.1's rule that the UI hiding an
    // action (or, here, disabling a button) is never the actual security/business-rule boundary.
    if (decision === 'REJECTED' && !comment?.trim()) {
      return fail('REASON_REQUIRED', 'Add a reason for rejecting this request so the requester knows what to fix.');
    }

    const updatedSteps = pr.approvalSteps.map((s, i) =>
      i === stepIndex ? { ...s, status: decision, decidedAt: new Date().toISOString(), comment, approverName: callerName } : s,
    );

    let status = pr.status;
    if (decision === 'REJECTED') {
      status = 'REJECTED';
    } else if (updatedSteps.every((s) => s.status === 'APPROVED')) {
      // Every step signed off - section 64's flow says the request becomes a purchase order
      // automatically at this point, one PO per supplier represented in the request's items.
      // Building it is purchase-order.service's job - imported lazily to avoid a circular
      // import, the same pattern acceptQuote already uses above.
      status = 'CONVERTED_TO_PO';
    }

    const next: PurchaseRequest = { ...pr, approvalSteps: updatedSteps, status };
    writeStore(PR_STORE_KEY, next.id, next);

    if (status === 'CONVERTED_TO_PO') {
      const { purchaseOrderService } = await import('./purchase-order.service');
      await purchaseOrderService.createFromPurchaseRequest(next, callerName ?? RoleLabels[callerRole] ?? 'Approver');
    }

    return ok(next);
  }

  // ---- Approval rules (section 12) ----

  async listApprovalRules(companyId: UUID): Promise<ServiceResult<ApprovalRule[]>> {
    await delay(200);
    return ok(
      allApprovalRules()
        .filter((r) => r.companyId === companyId)
        .sort((a, b) => a.minAmount - b.minAmount),
    );
  }

  async createApprovalRule(input: NewApprovalRuleInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<ApprovalRule>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, input.companyId)) return fail('NOT_FOUND', 'That company could not be found.');

    if (input.minAmount < 0) return fail('INVALID_RANGE', 'The minimum amount cannot be negative.');
    if (input.maxAmount !== undefined && input.maxAmount <= input.minAmount) {
      return fail('INVALID_RANGE', 'The maximum amount must be greater than the minimum.');
    }
    if (input.requiredApproverRoles.length === 0) return fail('EMPTY', 'Pick at least one approver role.');
    // A role that can never act on PURCHASE_REQUEST_APPROVE would permanently strand any
    // request that lands in this band - nobody could ever approve or reject it.
    const incapableRole = input.requiredApproverRoles.find((role) => !hasPermission(role as Role, Permission.PURCHASE_REQUEST_APPROVE));
    if (incapableRole) {
      return fail(
        'ROLE_CANNOT_APPROVE',
        `${RoleLabels[incapableRole as Role] ?? incapableRole} can't approve purchase requests, so a request routed to this role could never move forward.`,
      );
    }

    // Two bands covering the same amount would make resolution ambiguous - only the first
    // match would ever apply, silently ignoring the second rule the admin just configured.
    const existing = allApprovalRules().filter((r) => r.companyId === input.companyId);
    const overlaps = existing.some((r) => {
      const existingMax = r.maxAmount ?? Infinity;
      const newMax = input.maxAmount ?? Infinity;
      return input.minAmount <= existingMax && r.minAmount <= newMax;
    });
    if (overlaps) return fail('OVERLAPPING_RANGE', 'This range overlaps an existing approval rule for this company.');

    const rule: ApprovalRule = {
      id: newId('rule'),
      companyId: input.companyId,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
      requiredApproverRoles: input.requiredApproverRoles,
    };
    appendToList(RULE_STORE_KEY, rule);
    return ok(rule);
  }

  async removeApprovalRule(ruleId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(200);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const rule = allApprovalRules().find((r) => r.id === ruleId);
    if (!rule || !ownsRecord(caller, rule.companyId)) return fail('NOT_FOUND', 'That approval rule could not be found.');

    markRuleRemoved(ruleId);
    return ok(undefined);
  }
}

export const procurementService: ProcurementService = new ApiProcurementService();
