import { assertPermission, delay, fail, ok } from './base';
import { FLAT_DELIVERY_FEE, calculateTax } from '@/utils/pricing';
import {
  demoApprovalRules,
  demoNegotiationMessages,
  demoPurchaseRequests,
  demoQuotes,
  demoRfqs,
} from '@/lib/demo-data/procurement';
import { demoSuppliers } from '@/lib/demo-data/catalog';
import type { ServiceResult, UUID } from '@/types/common';
import type {
  ApprovalStep,
  NegotiationMessage,
  PurchaseRequest,
  PurchaseRequestItem,
  Quote,
  RFQ,
  RFQItem,
} from '@/types/procurement';
import { Permission, RoleLabels, type Role } from '@/config/rbac';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

// ---------- runtime persistence (seed + localStorage overrides, same pattern as auth.service) ----------

const PR_STORE_KEY = 'procurement.purchase-requests.v1';
const RFQ_STORE_KEY = 'procurement.rfqs.v1';
const QUOTE_STORE_KEY = 'procurement.quotes.v1';
const NEGOTIATION_STORE_KEY = 'procurement.negotiations.v1';

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

function allRfqs(): RFQ[] {
  const overrides = readStore<RFQ>(RFQ_STORE_KEY);
  const seeded = demoRfqs.map((r) => overrides[r.id] ?? r);
  const created = readList<RFQ>(RFQ_STORE_KEY).map((r) => overrides[r.id] ?? r);
  return [...seeded, ...created];
}

function allQuotes(): Quote[] {
  return [...demoQuotes, ...readList<Quote>(QUOTE_STORE_KEY)];
}

function allNegotiationMessages(): NegotiationMessage[] {
  return [...demoNegotiationMessages, ...readList<NegotiationMessage>(NEGOTIATION_STORE_KEY)];
}

// ---------- approval rule resolution (section 23) ----------

/** Resolves which roles must approve a purchase request of a given amount, per the company's
 *  configured spend bands, and turns that into an ordered list of pending approval steps.
 *  There's no admin UI to edit these bands yet (that's a Settings-page addition for later),
 *  but the resolution logic itself is real and this is the one place it lives. */
function resolveApprovalSteps(companyId: UUID, amount: number): ApprovalStep[] {
  const rule = demoApprovalRules
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
  items: PurchaseRequestItem[];
  reason: string;
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
  getRfq(id: UUID): Promise<ServiceResult<RFQ>>;
  createRfq(input: CreateRfqInput): Promise<ServiceResult<RFQ>>;
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
    proposedPrice?: number,
    proposedQuantity?: number,
  ): Promise<ServiceResult<NegotiationMessage[]>>;
  acceptQuote(rfqId: UUID, quoteId: UUID, authorizedByName: string): Promise<ServiceResult<{ purchaseOrderId: UUID }>>;

  listPurchaseRequests(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>>;
  getPurchaseRequest(id: UUID): Promise<ServiceResult<PurchaseRequest>>;
  createPurchaseRequest(input: CreatePurchaseRequestInput): Promise<ServiceResult<PurchaseRequest>>;
  listPendingApprovals(companyId: UUID, role: Role): Promise<ServiceResult<PurchaseRequest[]>>;
  decideStep(
    purchaseRequestId: UUID,
    callerRole: Role,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
    callerName?: string,
  ): Promise<ServiceResult<PurchaseRequest>>;
}

class MockProcurementService implements ProcurementService {
  // ---- RFQ ----

  async listRfqs(companyId: UUID): Promise<ServiceResult<RFQ[]>> {
    await delay(250);
    return ok(allRfqs().filter((r) => r.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async listRfqsForSupplier(supplierId: UUID): Promise<ServiceResult<RFQ[]>> {
    await delay(250);
    return ok(
      allRfqs()
        .filter((r) => r.suppliers.some((s) => s.supplierId === supplierId))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    );
  }

  async getRfq(id: UUID): Promise<ServiceResult<RFQ>> {
    await delay(200);
    const rfq = allRfqs().find((r) => r.id === id);
    if (!rfq) return fail('NOT_FOUND', 'That RFQ could not be found.');
    return ok(rfq);
  }

  async createRfq(input: CreateRfqInput): Promise<ServiceResult<RFQ>> {
    await delay(400);
    if (input.items.length === 0) return fail('EMPTY', 'Add at least one product to the RFQ.');
    if (input.supplierIds.length === 0) return fail('NO_SUPPLIERS', 'Invite at least one supplier.');

    const rfq: RFQ = {
      id: newId('rfq'),
      reference: `RFQ-${Math.floor(10000 + Math.random() * 89999)}`,
      companyId: input.companyId,
      createdByUserId: input.createdByUserId,
      items: input.items,
      requiredDeliveryDate: input.requiredDeliveryDate,
      deliveryLocation: input.deliveryLocation,
      additionalRequirements: input.additionalRequirements,
      attachmentIds: [],
      suppliers: input.supplierIds.map((supplierId) => ({
        supplierId,
        supplierName: demoSuppliers.find((s) => s.id === supplierId)?.name ?? 'Supplier',
        status: 'INVITED' as const,
      })),
      status: 'SENT',
      createdAt: new Date().toISOString(),
    };
    appendToList(RFQ_STORE_KEY, rfq);
    return ok(rfq);
  }

  // ---- Quotes ----

  async listQuotesForRfq(rfqId: UUID): Promise<ServiceResult<Quote[]>> {
    await delay(250);
    return ok(allQuotes().filter((q) => q.rfqId === rfqId));
  }

  async listQuotesForSupplier(supplierId: UUID): Promise<ServiceResult<Quote[]>> {
    await delay(250);
    return ok(allQuotes().filter((q) => q.supplierId === supplierId));
  }

  async submitQuote(input: SubmitQuoteInput, callerRole: Role): Promise<ServiceResult<Quote>> {
    await delay(400);
    const permissionError = assertPermission(callerRole, Permission.RFQ_RESPOND);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (input.items.length === 0) return fail('EMPTY', 'Quote at least one item.');

    const rfq = allRfqs().find((r) => r.id === input.rfqId);
    if (!rfq) return fail('NOT_FOUND', 'That RFQ could not be found.');
    const invitation = rfq.suppliers.find((s) => s.supplierId === input.supplierId);
    if (!invitation) return fail('NOT_INVITED', 'Your company was not invited to this RFQ.');
    if (allQuotes().some((q) => q.rfqId === input.rfqId && q.supplierId === input.supplierId)) {
      return fail('ALREADY_QUOTED', 'You have already submitted a quote for this RFQ.');
    }

    const totalPrice = input.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const quote: Quote = {
      id: newId('quote'),
      rfqId: input.rfqId,
      supplierId: input.supplierId,
      supplierName: invitation.supplierName,
      items: input.items.map((i) => ({ id: newId('qi'), productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
      totalPrice,
      deliveryDays: input.deliveryDays,
      warrantyMonths: input.warrantyMonths,
      notes: input.notes,
      submittedAt: new Date().toISOString(),
    };
    appendToList(QUOTE_STORE_KEY, quote);

    const updatedSuppliers = rfq.suppliers.map((s) => (s.supplierId === input.supplierId ? { ...s, status: 'QUOTED' as const } : s));
    const status = rfq.status === 'SENT' || rfq.status === 'VIEWED' ? ('QUOTED' as const) : rfq.status;
    writeStore(RFQ_STORE_KEY, rfq.id, { ...rfq, suppliers: updatedSuppliers, status });

    return ok(quote);
  }

  // ---- Negotiation ----

  async listNegotiationMessages(rfqId: UUID, quoteId: UUID): Promise<ServiceResult<NegotiationMessage[]>> {
    await delay(200);
    return ok(
      allNegotiationMessages()
        .filter((m) => m.rfqId === rfqId && m.quoteId === quoteId)
        .sort((a, b) => (a.sentAt < b.sentAt ? -1 : 1)),
    );
  }

  async sendNegotiationMessage(
    rfqId: UUID,
    quoteId: UUID,
    message: string,
    proposedPrice?: number,
    proposedQuantity?: number,
  ): Promise<ServiceResult<NegotiationMessage[]>> {
    await delay(300);
    if (!message.trim()) return fail('EMPTY', 'Write a message before sending.');

    const buyerMessage: NegotiationMessage = {
      id: newId('neg'),
      rfqId,
      quoteId,
      senderRole: 'BUYER',
      senderName: 'You',
      message,
      proposedPrice,
      proposedQuantity,
      sentAt: new Date().toISOString(),
    };
    appendToList(NEGOTIATION_STORE_KEY, buyerMessage);

    // No supplier portal exists yet (Phase 5) for a real counterpart to reply from - this
    // canned acknowledgement stands in for that so the thread stays usable to test end to end.
    // It is never presented as a live person; the sender name is the supplier's company name,
    // the same way the seeded negotiation history already renders.
    const quote = allQuotes().find((q) => q.id === quoteId);
    const supplierReply: NegotiationMessage = {
      id: newId('neg'),
      rfqId,
      quoteId,
      senderRole: 'SUPPLIER',
      senderName: quote?.supplierName ?? 'Supplier',
      message: proposedPrice
        ? `Thanks for the note - we'll review ${proposedPrice ? `₵${proposedPrice}` : 'your proposal'} and get back to you shortly.`
        : "Thanks for the note - we'll review this and get back to you shortly.",
      sentAt: new Date(Date.now() + 1000).toISOString(),
    };
    appendToList(NEGOTIATION_STORE_KEY, supplierReply);

    return this.listNegotiationMessages(rfqId, quoteId);
  }

  async acceptQuote(rfqId: UUID, quoteId: UUID, authorizedByName: string): Promise<ServiceResult<{ purchaseOrderId: UUID }>> {
    await delay(400);
    const rfq = allRfqs().find((r) => r.id === rfqId);
    const quote = allQuotes().find((q) => q.id === quoteId);
    if (!rfq || !quote) return fail('NOT_FOUND', 'That RFQ or quote could not be found.');

    writeStore(RFQ_STORE_KEY, rfq.id, { ...rfq, status: 'ACCEPTED' as const, acceptedQuoteId: quote.id });

    // Building a PurchaseOrder from an accepted quote is purchase-order.service's job -
    // imported lazily here to avoid a circular import between the two service modules.
    const { purchaseOrderService } = await import('./purchase-order.service');
    const po = await purchaseOrderService.createFromQuote(rfq, quote, authorizedByName);
    return ok({ purchaseOrderId: po.id });
  }

  // ---- Purchase requests ----

  async listPurchaseRequests(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>> {
    await delay(250);
    return ok(allPurchaseRequests().filter((pr) => pr.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async getPurchaseRequest(id: UUID): Promise<ServiceResult<PurchaseRequest>> {
    await delay(200);
    const pr = allPurchaseRequests().find((p) => p.id === id);
    if (!pr) return fail('NOT_FOUND', 'That purchase request could not be found.');
    return ok(pr);
  }

  async createPurchaseRequest(input: CreatePurchaseRequestInput): Promise<ServiceResult<PurchaseRequest>> {
    await delay(400);
    if (input.items.length === 0) return fail('EMPTY', 'Your cart is empty.');

    // Matches the cart page's own total exactly (subtotal + tax + delivery) - the approval
    // rule bands in resolveApprovalSteps gate on what the company will actually pay, not just
    // the line-item subtotal, so this has to be computed the same way here as it was there.
    const subtotal = input.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const totalAmount = subtotal + calculateTax(subtotal) + FLAT_DELIVERY_FEE;
    const pr: PurchaseRequest = {
      id: newId('pr'),
      reference: `PR-${Math.floor(10000 + Math.random() * 89999)}`,
      companyId: input.companyId,
      requesterUserId: input.requesterUserId,
      requesterName: input.requesterName,
      department: input.department,
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
    comment?: string,
    callerName?: string,
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
}

export const procurementService: ProcurementService = new MockProcurementService();
