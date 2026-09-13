import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toNegotiationMessageDto, toQuoteDto, toRfqDto } from '@/server/dto/procurement';
import type { ServiceResult, UUID } from '@/types/common';
import type { NegotiationMessage, Quote, RFQ, RFQItem } from '@/types/procurement';
import type { Prisma } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/procurement.service.ts's mock - RFQs,
 * quotes, and negotiation only (Phase 14, Stage 5). Purchase requests and approval rules stay
 * on the existing mock for now (they depend on spending-limit enforcement that hasn't migrated
 * yet - see company.service.ts's matching comment); accepting a quote here only updates the RFQ
 * side - building the resulting PurchaseOrder is still the client-side mock's job (see the
 * client procurement.service.ts's acceptQuote for why that boundary is safe to leave as-is).
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
