import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import {
  toApprovalRuleDto,
  toNegotiationMessageDto,
  toPurchaseRequestDto,
  toQuoteDto,
  toRfqDto,
} from '@/server/dto/procurement';
import { hasPermission, Permission, RoleLabels, type Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';
import type { ApprovalRule, NegotiationMessage, PurchaseRequest, PurchaseRequestItem, Quote, RFQ, RFQItem } from '@/types/procurement';
import type { Prisma } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/procurement.service.ts's mock - RFQs,
 * quotes, and negotiation (Phase 14, Stage 5), plus purchase requests, approval steps, and
 * approval rules (Stage 6). Accepting a quote / a purchase request's final approval both stop at
 * updating this domain's own records - building the resulting PurchaseOrder is still the
 * client-side mock's job (see the client procurement.service.ts's acceptQuote/decideStep for why
 * that boundary is safe to leave as-is until Stage 7 migrates PurchaseOrder itself).
 */

const RFQ_INCLUDE = {
  items: true,
  suppliers: { include: { supplier: true } },
} satisfies Prisma.RFQInclude;

const QUOTE_INCLUDE = { items: true, supplier: true } satisfies Prisma.QuoteInclude;

export async function listRfqs(companyId: UUID): Promise<ServiceResult<RFQ[]>> {
  const rfqs = await db.rFQ.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: RFQ_INCLUDE });
  return ok(rfqs.map(toRfqDto));
}

export async function listRfqsForSupplier(supplierId: UUID): Promise<ServiceResult<RFQ[]>> {
  const rfqs = await db.rFQ.findMany({
    where: { suppliers: { some: { supplierId } } },
    orderBy: { createdAt: 'desc' },
    include: RFQ_INCLUDE,
  });
  return ok(rfqs.map(toRfqDto));
}

/** No auth check here - the caller (buyer company vs. invited supplier vs. neither) is decided
 *  by the route handler against the fetched record, the same "ownership isn't known until the
 *  record is fetched" pattern Stage 4's product routes use, since an RFQ has two different
 *  *kinds* of legitimate owner. */
export async function getRfq(id: UUID): Promise<ServiceResult<RFQ>> {
  const rfq = await db.rFQ.findUnique({ where: { id }, include: RFQ_INCLUDE });
  if (!rfq) return fail('NOT_FOUND', 'That RFQ could not be found.');
  return ok(toRfqDto(rfq));
}

export interface CreateRfqInput {
  companyId: UUID;
  createdByUserId: UUID;
  items: Omit<RFQItem, 'id'>[];
  requiredDeliveryDate: string;
  deliveryLocation: string;
  additionalRequirements?: string;
  supplierIds: UUID[];
}

export async function createRfq(input: CreateRfqInput): Promise<ServiceResult<RFQ>> {
  if (input.items.length === 0) return fail('EMPTY', 'Add at least one product to the RFQ.');
  if (input.supplierIds.length === 0) return fail('NO_SUPPLIERS', 'Invite at least one supplier.');

  const reference = `RFQ-${Math.floor(10000 + Math.random() * 89999)}`;
  const rfq = await db.rFQ.create({
    data: {
      reference,
      companyId: input.companyId,
      createdByUserId: input.createdByUserId,
      requiredDeliveryDate: new Date(input.requiredDeliveryDate),
      deliveryLocation: input.deliveryLocation,
      additionalRequirements: input.additionalRequirements,
      status: 'SENT',
      items: { create: input.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })) },
      suppliers: { create: input.supplierIds.map((supplierId) => ({ supplierId, status: 'INVITED' })) },
    },
    include: RFQ_INCLUDE,
  });
  return ok(toRfqDto(rfq));
}

export async function listQuotesForRfq(rfqId: UUID): Promise<ServiceResult<Quote[]>> {
  const quotes = await db.quote.findMany({ where: { rfqId }, include: QUOTE_INCLUDE });
  return ok(quotes.map(toQuoteDto));
}

export async function listQuotesForSupplier(supplierId: UUID): Promise<ServiceResult<Quote[]>> {
  const quotes = await db.quote.findMany({ where: { supplierId }, include: QUOTE_INCLUDE });
  return ok(quotes.map(toQuoteDto));
}

export interface SubmitQuoteInput {
  rfqId: UUID;
  supplierId: UUID;
  items: { productId: UUID; quantity: number; unitPrice: number }[];
  deliveryDays: number;
  warrantyMonths: number;
  notes?: string;
}

export async function submitQuote(input: SubmitQuoteInput): Promise<ServiceResult<Quote>> {
  if (input.items.length === 0) return fail('EMPTY', 'Quote at least one item.');

  const rfq = await db.rFQ.findUnique({ where: { id: input.rfqId }, include: { suppliers: true } });
  if (!rfq) return fail('NOT_FOUND', 'That RFQ could not be found.');
  const invitation = rfq.suppliers.find((s) => s.supplierId === input.supplierId);
  if (!invitation) return fail('NOT_INVITED', 'Your company was not invited to this RFQ.');

  const existing = await db.quote.findFirst({ where: { rfqId: input.rfqId, supplierId: input.supplierId } });
  if (existing) return fail('ALREADY_QUOTED', 'You have already submitted a quote for this RFQ.');

  const totalPrice = input.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const quote = await db.$transaction(async (tx) => {
    const created = await tx.quote.create({
      data: {
        rfqId: input.rfqId,
        supplierId: input.supplierId,
        totalPrice,
        deliveryDays: input.deliveryDays,
        warrantyMonths: input.warrantyMonths,
        notes: input.notes,
        items: { create: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })) },
      },
      include: QUOTE_INCLUDE,
    });

    await tx.rFQSupplier.update({ where: { id: invitation.id }, data: { status: 'QUOTED' } });
    if (rfq.status === 'SENT' || rfq.status === 'VIEWED') {
      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: 'QUOTED' } });
    }

    return created;
  });

  return ok(toQuoteDto(quote));
}

export async function listNegotiationMessages(rfqId: UUID, quoteId: UUID): Promise<ServiceResult<NegotiationMessage[]>> {
  const messages = await db.negotiationMessage.findMany({
    where: { rfqId, quoteId },
    orderBy: { sentAt: 'asc' },
    include: { sender: true, quote: { include: { supplier: true } } },
  });
  return ok(messages.map(toNegotiationMessageDto));
}

/** Negotiation is one-directional in this build - see the mock's own comment, ported here
 *  unchanged: there's no real supplier-side reply UI yet, so a canned acknowledgement stands in
 *  for a live counterpart, clearly attributed to the supplier's company name rather than a real
 *  person. */
export async function sendNegotiationMessage(
  rfqId: UUID,
  quoteId: UUID,
  message: string,
  senderUserId: UUID,
  proposedPrice?: number,
  proposedQuantity?: number,
): Promise<ServiceResult<NegotiationMessage[]>> {
  if (!message.trim()) return fail('EMPTY', 'Write a message before sending.');

  const quote = await db.quote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.rfqId !== rfqId) return fail('NOT_FOUND', 'That quote could not be found.');

  await db.negotiationMessage.create({
    data: { rfqId, quoteId, senderRole: 'BUYER', senderUserId, message, proposedPrice, proposedQuantity },
  });
  await db.negotiationMessage.create({
    data: {
      rfqId,
      quoteId,
      senderRole: 'SUPPLIER',
      message: proposedPrice
        ? `Thanks for the note - we'll review ₵${proposedPrice} and get back to you shortly.`
        : "Thanks for the note - we'll review this and get back to you shortly.",
      sentAt: new Date(Date.now() + 1000),
    },
  });

  return listNegotiationMessages(rfqId, quoteId);
}

/** Marks the RFQ accepted and records which quote won (section 20 - lets analytics attribute a
 *  win to the exact quote, not just "the RFQ is ACCEPTED"). Does NOT create a PurchaseOrder -
 *  that's still the client-side mock purchase-order.service.ts's job, called by the client
 *  procurement.service.ts's acceptQuote with the real RFQ/Quote DTOs this returns. */
export async function acceptQuote(rfqId: UUID, quoteId: UUID): Promise<ServiceResult<{ rfq: RFQ; quote: Quote }>> {
  const rfq = await db.rFQ.findUnique({ where: { id: rfqId } });
  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: QUOTE_INCLUDE });
  if (!rfq || !quote || quote.rfqId !== rfqId) return fail('NOT_FOUND', 'That RFQ or quote could not be found.');

  const updated = await db.rFQ.update({
    where: { id: rfqId },
    data: { status: 'ACCEPTED', acceptedQuoteId: quoteId },
    include: RFQ_INCLUDE,
  });

  return ok({ rfq: toRfqDto(updated), quote: toQuoteDto(quote) });
}

// ---- Purchase requests (Stage 6) ----

const PURCHASE_REQUEST_INCLUDE = {
  items: true,
  approvalSteps: { include: { approver: true } },
  requester: true,
} satisfies Prisma.PurchaseRequestInclude;

/** Resolves which roles must approve a purchase request of a given amount, per the company's
 *  configured spend bands (ApprovalRule), and turns that into an ordered list of pending
 *  approval steps. A company with no matching band (or no rules at all) falls back to a single
 *  OWNER approval step, so a request is never silently left with nothing to gate it - ported
 *  unchanged from the client mock's resolveApprovalSteps. */
async function resolveApprovalSteps(companyId: UUID, amount: number): Promise<{ stepOrder: number; approverRole: Role }[]> {
  const rules = await db.approvalRule.findMany({ where: { companyId } });
  const rule = rules.find((r) => amount >= Number(r.minAmount) && (r.maxAmount === null || amount <= Number(r.maxAmount)));
  const roles = (rule?.requiredApproverRoles ?? ['OWNER']) as Role[];
  return roles.map((approverRole, index) => ({ stepOrder: index + 1, approverRole }));
}

export async function listPurchaseRequests(companyId: UUID): Promise<ServiceResult<PurchaseRequest[]>> {
  const requests = await db.purchaseRequest.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    include: PURCHASE_REQUEST_INCLUDE,
  });
  return ok(requests.map(toPurchaseRequestDto));
}

export async function getPurchaseRequest(id: UUID): Promise<ServiceResult<PurchaseRequest>> {
  const pr = await db.purchaseRequest.findUnique({ where: { id }, include: PURCHASE_REQUEST_INCLUDE });
  if (!pr) return fail('NOT_FOUND', 'That purchase request could not be found.');
  return ok(toPurchaseRequestDto(pr));
}

export interface CreatePurchaseRequestInput {
  companyId: UUID;
  requesterUserId: UUID;
  department?: string;
  costCenterId?: UUID;
  items: Omit<PurchaseRequestItem, 'id'>[];
  reason: string;
}

export async function createPurchaseRequest(input: CreatePurchaseRequestInput): Promise<ServiceResult<PurchaseRequest>> {
  if (input.items.length === 0) return fail('EMPTY', 'Your cart is empty.');

  // Matches the cart page's own total exactly (subtotal + tax + delivery), computed here from
  // the items themselves - never trusting a client-supplied total - so the approval rule bands
  // below gate on what the company will actually pay.
  const { FLAT_DELIVERY_FEE, calculateTax } = await import('@/utils/pricing');
  const subtotal = input.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const totalAmount = subtotal + calculateTax(subtotal) + FLAT_DELIVERY_FEE;

  // Spending limit (section 11.5) - a business rule layered on top of the permission check the
  // route already ran, never a replacement for it.
  const { getEffectiveSpendingLimit } = await import('./company.service');
  const membership = await db.companyMembership.findUnique({
    where: { companyId_userId: { companyId: input.companyId, userId: input.requesterUserId } },
  });
  const limit = membership ? await getEffectiveSpendingLimit(input.companyId, membership.role as Role) : undefined;
  if (limit !== undefined && totalAmount > limit) {
    return fail(
      'SPENDING_LIMIT_EXCEEDED',
      `This request totals ${totalAmount.toLocaleString()}, above your role's ${limit.toLocaleString()} limit per request. Ask someone with a higher limit to submit it, or split it into smaller requests.`,
    );
  }

  const reference = `PR-${Math.floor(10000 + Math.random() * 89999)}`;
  const steps = await resolveApprovalSteps(input.companyId, totalAmount);

  const pr = await db.purchaseRequest.create({
    data: {
      reference,
      companyId: input.companyId,
      requesterUserId: input.requesterUserId,
      department: input.department,
      costCenterId: input.costCenterId,
      totalAmount,
      reason: input.reason,
      status: 'IN_APPROVAL',
      items: { create: input.items },
      approvalSteps: { create: steps },
    },
    include: PURCHASE_REQUEST_INCLUDE,
  });
  return ok(toPurchaseRequestDto(pr));
}

/** Only the *next* pending step (steps are sequential) matters - a later step waiting on this
 *  role shouldn't surface before earlier steps are decided. */
export async function listPendingApprovals(companyId: UUID, role: Role): Promise<ServiceResult<PurchaseRequest[]>> {
  const candidates = await db.purchaseRequest.findMany({
    where: { companyId, status: 'IN_APPROVAL' },
    include: PURCHASE_REQUEST_INCLUDE,
  });
  const pending = candidates.filter((pr) => {
    const next = pr.approvalSteps.filter((s) => s.status === 'PENDING').sort((a, b) => a.stepOrder - b.stepOrder)[0];
    return next?.approverRole === role;
  });
  return ok(pending.map(toPurchaseRequestDto));
}

/** Rejecting a step requires `comment` (enforced here, not just in the UI) so the requester
 *  always knows what to fix. Does NOT create a PurchaseOrder when every step is approved - that
 *  stays the client-side mock's job, triggered by the caller when it sees CONVERTED_TO_PO. */
export async function decideStep(
  purchaseRequestId: UUID,
  callerRole: Role,
  decision: 'APPROVED' | 'REJECTED',
  approverUserId: UUID,
  comment?: string,
): Promise<ServiceResult<PurchaseRequest>> {
  const pr = await db.purchaseRequest.findUnique({ where: { id: purchaseRequestId }, include: { approvalSteps: true } });
  if (!pr) return fail('NOT_FOUND', 'That purchase request could not be found.');

  const step = pr.approvalSteps.filter((s) => s.status === 'PENDING').sort((a, b) => a.stepOrder - b.stepOrder)[0];
  if (!step || step.approverRole !== callerRole) {
    return fail(
      'WRONG_APPROVER',
      `This request is waiting on ${step ? RoleLabels[step.approverRole as Role] ?? step.approverRole : 'no one'}, not your role.`,
    );
  }
  if (decision === 'REJECTED' && !comment?.trim()) {
    return fail('REASON_REQUIRED', 'Add a reason for rejecting this request so the requester knows what to fix.');
  }

  const updated = await db.$transaction(async (tx) => {
    await tx.approvalStep.update({
      where: { id: step.id },
      data: { status: decision, decidedAt: new Date(), comment, approverUserId },
    });

    const remaining = await tx.approvalStep.findMany({ where: { requestId: purchaseRequestId } });
    let status: 'IN_APPROVAL' | 'REJECTED' | 'CONVERTED_TO_PO' = pr.status as 'IN_APPROVAL';
    if (decision === 'REJECTED') {
      status = 'REJECTED';
    } else if (remaining.every((s) => (s.id === step.id ? true : s.status === 'APPROVED'))) {
      status = 'CONVERTED_TO_PO';
    }

    return tx.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { status }, include: PURCHASE_REQUEST_INCLUDE });
  });

  return ok(toPurchaseRequestDto(updated));
}

// ---- Approval rules (section 12 - admin-configurable spend bands) ----

export async function listApprovalRules(companyId: UUID): Promise<ServiceResult<ApprovalRule[]>> {
  const rules = await db.approvalRule.findMany({ where: { companyId }, orderBy: { minAmount: 'asc' } });
  return ok(rules.map(toApprovalRuleDto));
}

export interface NewApprovalRuleInput {
  companyId: UUID;
  minAmount: number;
  maxAmount?: number;
  requiredApproverRoles: string[];
}

export async function createApprovalRule(input: NewApprovalRuleInput): Promise<ServiceResult<ApprovalRule>> {
  if (input.minAmount < 0) return fail('INVALID_RANGE', 'The minimum amount cannot be negative.');
  if (input.maxAmount !== undefined && input.maxAmount <= input.minAmount) {
    return fail('INVALID_RANGE', 'The maximum amount must be greater than the minimum.');
  }
  if (input.requiredApproverRoles.length === 0) return fail('EMPTY', 'Pick at least one approver role.');
  // A role that can never act on PURCHASE_REQUEST_APPROVE would permanently strand any request
  // that lands in this band - nobody could ever approve or reject it.
  const incapableRole = input.requiredApproverRoles.find((role) => !hasPermission(role as Role, Permission.PURCHASE_REQUEST_APPROVE));
  if (incapableRole) {
    return fail(
      'ROLE_CANNOT_APPROVE',
      `${RoleLabels[incapableRole as Role] ?? incapableRole} can't approve purchase requests, so a request routed to this role could never move forward.`,
    );
  }

  // Two bands covering the same amount would make resolution ambiguous - only the first match
  // would ever apply, silently ignoring the second rule the admin just configured.
  const existing = await db.approvalRule.findMany({ where: { companyId: input.companyId } });
  const overlaps = existing.some((r) => {
    const existingMax = r.maxAmount ? Number(r.maxAmount) : Infinity;
    const newMax = input.maxAmount ?? Infinity;
    return input.minAmount <= existingMax && Number(r.minAmount) <= newMax;
  });
  if (overlaps) return fail('OVERLAPPING_RANGE', 'This range overlaps an existing approval rule for this company.');

  const rule = await db.approvalRule.create({
    data: {
      companyId: input.companyId,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
      requiredApproverRoles: input.requiredApproverRoles as Role[],
    },
  });
  return ok(toApprovalRuleDto(rule));
}

export async function removeApprovalRule(companyId: UUID, ruleId: UUID): Promise<ServiceResult<void>> {
  const { count } = await db.approvalRule.deleteMany({ where: { id: ruleId, companyId } });
  if (count === 0) return fail('NOT_FOUND', 'That approval rule could not be found.');
  return ok(undefined);
}
