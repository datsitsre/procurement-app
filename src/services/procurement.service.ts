import { apiRequest } from './base';
import type { Page, ServiceResult, TenantContext, UUID } from '@/types/common';
import type { ApprovalRule, NegotiationMessage, PurchaseRequest, PurchaseRequestItem, Quote, RFQ, RFQItem } from '@/types/procurement';
import type { Role } from '@/config/rbac';

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
  /** Paginated (Phase 19, section 1) - `?page=&pageSize=`, default 25, max 100, matching every
   *  other tenant-scoped list endpoint (`Page<RFQ>`, not a bare array). */
  listRfqs(companyId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<RFQ>>>;
  /** RFQs a supplier has been invited to respond to (section 18/44) - the supplier-workspace
   *  counterpart to `listRfqs`, which is keyed by the *buyer's* company id instead. Paginated,
   *  same shape. */
  listRfqsForSupplier(supplierId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<RFQ>>>;
  /** Real database count (Phase 19) - the buyer/supplier dashboards' own "pending RFQs" stat,
   *  across the company/supplier's *entire* RFQ history, never just whatever page is loaded. */
  getRfqPendingCount(companyId: UUID): Promise<ServiceResult<number>>;
  getRfqPendingCountForSupplier(supplierId: UUID): Promise<ServiceResult<number>>;
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

  listPurchaseRequests(companyId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<PurchaseRequest>>>;
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
 * Calls the real `/api/rfqs/*`, `/api/suppliers/[supplierId]/{rfqs,quotes}`, `/api/companies/
 * [companyId]/{purchase-requests,approval-rules}`, and `/api/purchase-requests/[id]/*` backend
 * (Phase 14: RFQs/quotes/negotiation in Stage 5; purchase requests, approval steps, and approval
 * rules in Stage 6). `callerRole`/`caller` are still accepted on several methods (every existing
 * page already passes them) but are never sent over the wire and never trusted for authorization
 * - the API derives the caller's role and tenant from the session cookie itself
 * (server/auth/require.ts, server/services/procurement.service.ts). Keeping these parameters
 * means every consuming page needed zero changes.
 */
class ApiProcurementService implements ProcurementService {
  // ---- RFQ ----

  async listRfqs(companyId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<RFQ>>> {
    return apiRequest<Page<RFQ>>(`/api/rfqs?companyId=${companyId}&page=${page}&pageSize=${pageSize}`);
  }

  async listRfqsForSupplier(supplierId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<RFQ>>> {
    return apiRequest<Page<RFQ>>(`/api/suppliers/${supplierId}/rfqs?page=${page}&pageSize=${pageSize}`);
  }

  async getRfqPendingCount(companyId: UUID): Promise<ServiceResult<number>> {
    const result = await apiRequest<{ count: number }>(`/api/rfqs/pending-count?companyId=${companyId}`);
    return result.ok ? { ok: true, data: result.data.count } : result;
  }

  async getRfqPendingCountForSupplier(supplierId: UUID): Promise<ServiceResult<number>> {
    const result = await apiRequest<{ count: number }>(`/api/suppliers/${supplierId}/rfqs/pending-count`);
    return result.ok ? { ok: true, data: result.data.count } : result;
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

  async acceptQuote(rfqId: UUID, quoteId: UUID): Promise<ServiceResult<{ purchaseOrderId: UUID }>> {
    // The server builds the resulting PurchaseOrder in the same request now (Phase 14, Stage 7)
    // - no separate client-side purchase-order.service call needed anymore.
    return apiRequest<{ purchaseOrderId: UUID }>(`/api/rfqs/${rfqId}/quotes/${quoteId}/accept`, { method: 'POST' });
  }

  // ---- Purchase requests ----

  async listPurchaseRequests(companyId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<PurchaseRequest>>> {
    return apiRequest<Page<PurchaseRequest>>(`/api/companies/${companyId}/purchase-requests?page=${page}&pageSize=${pageSize}`);
  }

  async getPurchaseRequest(id: UUID): Promise<ServiceResult<PurchaseRequest>> {
    return apiRequest<PurchaseRequest>(`/api/purchase-requests/${id}`);
  }

  async createPurchaseRequest(input: CreatePurchaseRequestInput): Promise<ServiceResult<PurchaseRequest>> {
    const body = { department: input.department, costCenterId: input.costCenterId, items: input.items, reason: input.reason };
    return apiRequest<PurchaseRequest>(`/api/companies/${input.companyId}/purchase-requests`, { method: 'POST', body: JSON.stringify(body) });
  }

  async listPendingApprovals(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>> {
    return apiRequest<PurchaseRequest[]>(`/api/companies/${companyId}/purchase-requests/pending`);
  }

  async decideStep(purchaseRequestId: UUID, callerRole: Role, decision: 'APPROVED' | 'REJECTED', caller: TenantContext, comment?: string): Promise<ServiceResult<PurchaseRequest>> {
    // The server builds a PurchaseOrder per supplier once every step is approved, in the same
    // request now (Phase 14, Stage 7) - no separate client-side purchase-order.service call
    // needed anymore.
    return apiRequest<PurchaseRequest>(`/api/purchase-requests/${purchaseRequestId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    });
  }

  // ---- Approval rules (section 12) ----

  async listApprovalRules(companyId: UUID): Promise<ServiceResult<ApprovalRule[]>> {
    return apiRequest<ApprovalRule[]>(`/api/companies/${companyId}/approval-rules`);
  }

  async createApprovalRule(input: NewApprovalRuleInput): Promise<ServiceResult<ApprovalRule>> {
    const { companyId, ...body } = input;
    return apiRequest<ApprovalRule>(`/api/companies/${companyId}/approval-rules`, { method: 'POST', body: JSON.stringify(body) });
  }

  async removeApprovalRule(ruleId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That approval rule could not be found.' } };
    return apiRequest<void>(`/api/companies/${companyId}/approval-rules/${ruleId}`, { method: 'DELETE' });
  }
}

export const procurementService: ProcurementService = new ApiProcurementService();
