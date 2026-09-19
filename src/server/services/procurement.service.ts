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
import { toPage, type PaginationParams } from '@/server/pagination';
import type { Page, ServiceResult, UUID } from '@/types/common';
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

/** Paginated (Phase 19, section 1) - a buyer's RFQ history grows with every quotation request and
 *  has no natural upper bound over a multi-year account, the same shape as `listOrders`. Tenant
 *  filtering happens inside the same query as pagination, never after. */
export async function listRfqs(companyId: UUID, pagination: PaginationParams): Promise<ServiceResult<Page<RFQ>>> {
  const [rfqs, total] = await Promise.all([
    db.rFQ.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: RFQ_INCLUDE, skip: pagination.skip, take: pagination.take }),
    db.rFQ.count({ where: { companyId } }),
  ]);
  return ok(toPage(rfqs.map(toRfqDto), total, pagination));
}

export async function listRfqsForSupplier(supplierId: UUID, pagination: PaginationParams): Promise<ServiceResult<Page<RFQ>>> {
  const where = { suppliers: { some: { supplierId } } };
  const [rfqs, total] = await Promise.all([
    db.rFQ.findMany({ where, orderBy: { createdAt: 'desc' }, include: RFQ_INCLUDE, skip: pagination.skip, take: pagination.take }),
    db.rFQ.count({ where }),
  ]);
  return ok(toPage(rfqs.map(toRfqDto), total, pagination));
}

/** Real counts, never derived from a page of `listRfqs`/`listRfqsForSupplier` (Phase 19) - the
 *  buyer/supplier dashboards' own "pending RFQs" stat cards need this across the *entire* tenant
 *  history, not just whatever happens to be on the current page. Matches the same
 *  `getSupplierOrdersToFulfillCount` pattern already established in `orders.service.ts`. */
export async function getRfqPendingCount(companyId: UUID): Promise<ServiceResult<number>> {
  const count = await db.rFQ.count({
    where: { companyId, status: { notIn: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'DRAFT'] } },
  });
  return ok(count);
}

export async function getRfqPendingCountForSupplier(supplierId: UUID): Promise<ServiceResult<number>> {
  const count = await db.rFQ.count({
    where: { suppliers: { some: { supplierId, status: 'INVITED' } } },
  });
  return ok(count);
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

  const quoteDto = toQuoteDto(quote);
  const { notifyUser } = await import('./notification.service');
  await notifyUser(rfq.createdByUserId, {
    type: 'QUOTE_RECEIVED',
    title: `Supplier responded to ${rfq.reference}`,
    body: `${quoteDto.supplierName} submitted a quote.`,
    entityId: rfq.id,
    entityHref: `/rfqs/${rfq.id}`,
  });

  return ok(quoteDto);
}

export async function listNegotiationMessages(rfqId: UUID, quoteId: UUID): Promise<ServiceResult<NegotiationMessage[]>> {
  const messages = await db.negotiationMessage.findMany({
    where: { rfqId, quoteId },
    orderBy: { sentAt: 'asc' },
    include: { sender: true, quote: { include: { supplier: true } } },
  });
  return ok(messages.map(toNegotiationMessageDto));
}

/** Real two-directional negotiation - both the buyer and the invited supplier can post into the
 *  same thread. `senderRole` is passed in by the route, not inferred here, because the route is
 *  the layer that already resolved which side the authenticated caller actually is (RFQ owner vs
 *  the quote's own supplier) - this function just records the message that side sent. Previously
 *  a supplier "reply" was a canned acknowledgement auto-appended after every buyer message (a
 *  stand-in ported from the client mock, from before there was a real supplier portal to reply
 *  from) - that's gone now that a real supplier user can open this thread and type one.
 *
 *  Notifies whichever side didn't just send the message - a BUYER message notifies the quote's
 *  own supplier company (the same SUPPLIER_ADMIN/SUPPLIER_STAFF audience other supplier-facing
 *  events already use), a SUPPLIER message notifies the RFQ's creator, mirroring submitQuote's
 *  own QUOTE_RECEIVED notification above. Fire-and-forget, same as every other notification in
 *  this codebase - a notification failure must never fail the message send itself. */
export async function sendNegotiationMessage(
  rfqId: UUID,
  quoteId: UUID,
  message: string,
  senderUserId: UUID,
  senderRole: 'BUYER' | 'SUPPLIER',
  proposedPrice?: number,
  proposedQuantity?: number,
): Promise<ServiceResult<NegotiationMessage[]>> {
  if (!message.trim()) return fail('EMPTY', 'Write a message before sending.');

  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: QUOTE_INCLUDE });
  if (!quote || quote.rfqId !== rfqId) return fail('NOT_FOUND', 'That quote could not be found.');

  const rfq = await db.rFQ.findUnique({ where: { id: rfqId } });
  if (!rfq) return fail('NOT_FOUND', 'That RFQ could not be found.');

  await db.negotiationMessage.create({
    data: { rfqId, quoteId, senderRole, senderUserId, message, proposedPrice, proposedQuantity },
  });

  const { notifyUser, notifyCompanyRoles } = await import('./notification.service');
  if (senderRole === 'BUYER') {
    await notifyCompanyRoles(quote.supplier.companyId, ['SUPPLIER_ADMIN', 'SUPPLIER_STAFF'], {
      type: 'NEGOTIATION_MESSAGE',
      title: `New message on ${rfq.reference}`,
      body: 'The buyer sent a message about your quote.',
      entityId: rfqId,
      entityHref: `/rfqs/${rfqId}`,
    });
  } else {
    await notifyUser(rfq.createdByUserId, {
      type: 'NEGOTIATION_MESSAGE',
      title: `New message on ${rfq.reference}`,
      body: `${quote.supplier.name} sent a message about their quote.`,
      entityId: rfqId,
      entityHref: `/rfqs/${rfqId}`,
    });
  }

  return listNegotiationMessages(rfqId, quoteId);
}

/** Marks the RFQ accepted and records which quote won (section 20 - lets analytics attribute a
 *  win to the exact quote, not just "the RFQ is ACCEPTED"), then builds the resulting
 *  PurchaseOrder in the same request (Phase 14, Stage 7 - previously a follow-up client-side
 *  mock call; see purchase-order.service.ts's own comment on why this boundary moved). */
/** Accepting a quote is not idempotent by nature - each call would otherwise build a brand new
 *  PurchaseOrder - so a double-click, a retried request, or two genuinely concurrent requests for
 *  the same RFQ must never both succeed (section 6/25's concurrency-audit concern, explicitly
 *  naming "quote" as one of the domains to check). Guarded with an atomic conditional update
 *  (`updateMany` with the current status in the `where` clause, not a separate read-then-write) -
 *  the database itself decides which concurrent caller wins, and the loser sees a clean CONFLICT
 *  rather than silently creating a second purchase order. The RFQ update and the resulting
 *  PurchaseOrder are created in the same transaction, so a failure partway through can never leave
 *  the RFQ stuck ACCEPTED with no PO to show for it. */
export async function acceptQuote(
  rfqId: UUID,
  quoteId: UUID,
  authorizedByName: string,
): Promise<ServiceResult<{ rfq: RFQ; quote: Quote; purchaseOrderId: UUID }>> {
  const quote = await db.quote.findUnique({ where: { id: quoteId }, include: QUOTE_INCLUDE });
  if (!quote || quote.rfqId !== rfqId) return fail('NOT_FOUND', 'That RFQ or quote could not be found.');

  const result = await db.$transaction(async (tx) => {
    const { count } = await tx.rFQ.updateMany({
      where: { id: rfqId, status: { not: 'ACCEPTED' } },
      data: { status: 'ACCEPTED', acceptedQuoteId: quoteId },
    });
    if (count === 0) return null;

    const updated = await tx.rFQ.findUnique({ where: { id: rfqId }, include: RFQ_INCLUDE });
    if (!updated) return null;

    const rfqDto = toRfqDto(updated);
    const quoteDto = toQuoteDto(quote);
    const { createFromQuote } = await import('./purchase-order.service');
    const po = await createFromQuote(rfqDto, quoteDto, authorizedByName, tx);

    return { rfq: rfqDto, quote: quoteDto, purchaseOrderId: po.id };
  });

  if (!result) return fail('CONFLICT', 'This RFQ has already been accepted.');
  return ok(result);
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

/** Paginated (Phase 16, section 5). Tenant scoping happens inside the same query as pagination,
 *  never after. */
export async function listPurchaseRequests(companyId: UUID, pagination: PaginationParams): Promise<ServiceResult<Page<PurchaseRequest>>> {
  const [requests, total] = await Promise.all([
    db.purchaseRequest.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: PURCHASE_REQUEST_INCLUDE,
      skip: pagination.skip,
      take: pagination.take,
    }),
    db.purchaseRequest.count({ where: { companyId } }),
  ]);
  return ok(toPage(requests.map(toPurchaseRequestDto), total, pagination));
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

  // Budget enforcement (section 6/32) - resolves the single most specific budget this request's
  // department/cost-center/company scope would draw against (never a client-supplied budget id),
  // then atomically reserves the amount inside the same transaction as the insert. No applicable
  // budget at all is not a constraint (matches the pre-existing "budgets are informational unless
  // configured" behavior); an applicable budget that doesn't have room rejects the request before
  // any row is written.
  const { findApplicableBudget, reserveBudget } = await import('./budget.service');
  const now = new Date();
  const applicableBudget = await findApplicableBudget(input.companyId, input.department, input.costCenterId, now);

  const pr = await db.$transaction(async (tx) => {
    if (applicableBudget) {
      const reserved = await reserveBudget(applicableBudget.id, totalAmount, tx);
      if (!reserved) return 'BUDGET_EXCEEDED' as const;
    }

    return tx.purchaseRequest.create({
      data: {
        reference,
        companyId: input.companyId,
        requesterUserId: input.requesterUserId,
        department: input.department,
        costCenterId: input.costCenterId,
        totalAmount,
        reason: input.reason,
        status: 'IN_APPROVAL',
        budgetId: applicableBudget?.id,
        budgetReservedAmount: applicableBudget ? totalAmount : undefined,
        items: { create: input.items },
        approvalSteps: { create: steps },
      },
      include: PURCHASE_REQUEST_INCLUDE,
    });
  });

  if (pr === 'BUDGET_EXCEEDED') {
    const available = applicableBudget!.amount - applicableBudget!.committedAmount;
    return fail(
      'BUDGET_EXCEEDED',
      `This request totals ${totalAmount.toLocaleString()}, which exceeds the ${available.toLocaleString()} remaining in the applicable budget. Reduce the request or ask someone to adjust the budget.`,
    );
  }

  const prDto = toPurchaseRequestDto(pr);
  const firstStep = prDto.approvalSteps[0];
  if (firstStep) {
    const { notifyCompanyRoles } = await import('./notification.service');
    await notifyCompanyRoles(input.companyId, [firstStep.approverRole as Role], {
      type: 'APPROVAL_REQUESTED',
      title: 'Purchase request requires approval',
      body: `${prDto.reference} (₵${totalAmount.toLocaleString()}) is waiting on ${RoleLabels[firstStep.approverRole as Role] ?? firstStep.approverRole}.`,
      entityId: pr.id,
      entityHref: '/approvals',
    });
  }

  return ok(prDto);
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
 *  always knows what to fix. Builds a PurchaseOrder per distinct supplier once every step is
 *  approved (Phase 14, Stage 7 - previously a follow-up client-side mock call triggered by the
 *  caller seeing CONVERTED_TO_PO). `authorizedByName` names whoever's approval completed the
 *  request, for the resulting PurchaseOrder's own record of who authorized it. */
/** Deciding an approval step is not idempotent - reaching the final step's decision also
 *  converts the request into a real PurchaseOrder - so two concurrent decisions on the same step
 *  (a double-click, a retried request) must never both proceed, exactly the acceptQuote race
 *  (section 6/25). Guarded the same way: an atomic conditional `updateMany` requiring the step
 *  still be PENDING, not a separate read-then-write - the database decides which caller wins,
 *  the loser gets a clean CONFLICT instead of silently creating a second purchase order or
 *  clobbering the first decision's `comment`/`approverUserId`. */
export async function decideStep(
  purchaseRequestId: UUID,
  callerRole: Role,
  decision: 'APPROVED' | 'REJECTED',
  approverUserId: UUID,
  authorizedByName: string,
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

  const { createFromPurchaseRequest } = await import('./purchase-order.service');
  const { releaseBudget } = await import('./budget.service');

  const updated = await db.$transaction(async (tx) => {
    const { count } = await tx.approvalStep.updateMany({
      where: { id: step.id, status: 'PENDING' },
      data: { status: decision, decidedAt: new Date(), comment, approverUserId },
    });
    if (count === 0) return null;

    const remaining = await tx.approvalStep.findMany({ where: { requestId: purchaseRequestId } });
    let status: 'IN_APPROVAL' | 'REJECTED' | 'CONVERTED_TO_PO' = pr.status as 'IN_APPROVAL';
    if (decision === 'REJECTED') {
      status = 'REJECTED';
    } else if (remaining.every((s) => (s.id === step.id ? true : s.status === 'APPROVED'))) {
      status = 'CONVERTED_TO_PO';
    }

    const request = await tx.purchaseRequest.update({ where: { id: purchaseRequestId }, data: { status }, include: PURCHASE_REQUEST_INCLUDE });

    // A rejected request releases whatever budget it had reserved (section 6) - never lets a
    // dead request permanently shrink the budget's available room. An approved-but-not-yet-final
    // step keeps its reservation, since the request is still alive and could still convert to a PO.
    if (status === 'REJECTED' && pr.budgetId && pr.budgetReservedAmount) {
      await releaseBudget(pr.budgetId, Number(pr.budgetReservedAmount), tx);
    }

    // Building the resulting PurchaseOrder(s) in the same transaction as the status flip - a
    // failure here rolls back the approval decision too, rather than leaving the request stuck
    // CONVERTED_TO_PO with no (or partial) purchase orders to show for it.
    if (status === 'CONVERTED_TO_PO') {
      await createFromPurchaseRequest(toPurchaseRequestDto(request), authorizedByName, tx);
    }

    return request;
  });

  if (!updated) return fail('CONFLICT', 'This approval step has already been decided.');

  const updatedDto = toPurchaseRequestDto(updated);

  const { notifyUser, notifyCompanyRoles } = await import('./notification.service');
  if (updated.status === 'REJECTED' || updated.status === 'CONVERTED_TO_PO') {
    // The request reached a final decision - the person who asked for it should hear the
    // outcome, whichever way it went.
    await notifyUser(updated.requesterUserId, {
      type: 'APPROVAL_DECIDED',
      title: `${updatedDto.reference} was ${updated.status === 'REJECTED' ? 'rejected' : 'approved'}`,
      body: updated.status === 'REJECTED' ? (comment ?? 'No reason given.') : 'Every approval step has signed off.',
      entityId: updated.id,
      entityHref: `/purchase-requests/${updated.id}`,
    });
  } else {
    // Still IN_APPROVAL - the next band in the sequence is now waiting on them.
    const nextStep = updatedDto.approvalSteps.find((s) => s.status === 'PENDING');
    if (nextStep) {
      await notifyCompanyRoles(updated.companyId, [nextStep.approverRole as Role], {
        type: 'APPROVAL_REQUESTED',
        title: 'Purchase request requires approval',
        body: `${updatedDto.reference} (₵${updatedDto.totalAmount.toLocaleString()}) is waiting on ${RoleLabels[nextStep.approverRole as Role] ?? nextStep.approverRole}.`,
        entityId: updated.id,
        entityHref: '/approvals',
      });
    }
  }

  return ok(updatedDto);
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
