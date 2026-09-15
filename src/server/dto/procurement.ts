import 'server-only';
import type {
  ApprovalRule,
  ApprovalStep,
  NegotiationMessage,
  PurchaseRequest,
  PurchaseRequestItem,
  Quote,
  QuoteItem,
  RFQ,
  RFQItem,
  RFQSupplier,
} from '@/types/procurement';
import type {
  ApprovalRule as PrismaApprovalRule,
  ApprovalStep as PrismaApprovalStep,
  NegotiationMessage as PrismaNegotiationMessage,
  PurchaseRequest as PrismaPurchaseRequest,
  PurchaseRequestItem as PrismaPurchaseRequestItem,
  Quote as PrismaQuote,
  QuoteItem as PrismaQuoteItem,
  RFQ as PrismaRFQ,
  RFQItem as PrismaRFQItem,
  RFQSupplier as PrismaRFQSupplier,
  SupplierProfile,
  User,
} from '@prisma/client';

/** Maps Prisma's generated RFQ/Quote/Negotiation models to the exact frontend types
 *  (src/types/procurement.ts). Neither RFQSupplier, Quote, nor NegotiationMessage store a
 *  supplier/sender *name* column - the frontend type has one (for display without a second
 *  lookup), so every mapper here takes the already-joined supplier/user record and derives it,
 *  never a raw ORM entity crossing the API boundary (section 36). */

export function toRfqItemDto(i: PrismaRFQItem): RFQItem {
  return { id: i.id, productId: i.productId, productName: i.productName, quantity: i.quantity };
}

export function toRfqSupplierDto(s: PrismaRFQSupplier & { supplier: SupplierProfile }): RFQSupplier {
  return { supplierId: s.supplierId, supplierName: s.supplier.name, status: s.status };
}

type RfqWithRelations = PrismaRFQ & {
  items: PrismaRFQItem[];
  suppliers: (PrismaRFQSupplier & { supplier: SupplierProfile })[];
};

export function toRfqDto(r: RfqWithRelations): RFQ {
  return {
    id: r.id,
    reference: r.reference,
    companyId: r.companyId,
    createdByUserId: r.createdByUserId,
    items: r.items.map(toRfqItemDto),
    requiredDeliveryDate: r.requiredDeliveryDate.toISOString(),
    deliveryLocation: r.deliveryLocation,
    additionalRequirements: r.additionalRequirements ?? undefined,
    attachmentIds: [],
    suppliers: r.suppliers.map(toRfqSupplierDto),
    status: r.status,
    acceptedQuoteId: r.acceptedQuoteId ?? undefined,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString(),
  };
}

export function toQuoteItemDto(i: PrismaQuoteItem): QuoteItem {
  return { id: i.id, productId: i.productId, quantity: i.quantity, unitPrice: Number(i.unitPrice) };
}

type QuoteWithRelations = PrismaQuote & { items: PrismaQuoteItem[]; supplier: SupplierProfile };

export function toQuoteDto(q: QuoteWithRelations): Quote {
  return {
    id: q.id,
    rfqId: q.rfqId,
    supplierId: q.supplierId,
    supplierName: q.supplier.name,
    items: q.items.map(toQuoteItemDto),
    totalPrice: Number(q.totalPrice),
    deliveryDays: q.deliveryDays,
    warrantyMonths: q.warrantyMonths,
    notes: q.notes ?? undefined,
    submittedAt: q.submittedAt.toISOString(),
  };
}

type NegotiationWithRelations = PrismaNegotiationMessage & {
  sender: User | null;
  quote: PrismaQuote & { supplier: SupplierProfile };
};

export function toNegotiationMessageDto(m: NegotiationWithRelations): NegotiationMessage {
  return {
    id: m.id,
    rfqId: m.rfqId,
    quoteId: m.quoteId,
    senderRole: m.senderRole,
    // Both sides now always have a real senderUserId (see sendNegotiationMessage) - the
    // supplier's company name is kept only as a defensive fallback for a message that somehow
    // has none, never the expected path.
    senderName: m.sender?.name ?? m.quote.supplier.name,
    message: m.message,
    proposedPrice: m.proposedPrice ? Number(m.proposedPrice) : undefined,
    proposedQuantity: m.proposedQuantity ?? undefined,
    sentAt: m.sentAt.toISOString(),
  };
}

export function toApprovalStepDto(s: PrismaApprovalStep & { approver?: User | null }): ApprovalStep {
  return {
    id: s.id,
    stepOrder: s.stepOrder,
    approverRole: s.approverRole,
    approverName: s.approver?.name ?? undefined,
    status: s.status,
    decidedAt: s.decidedAt?.toISOString(),
    comment: s.comment ?? undefined,
  };
}

export function toPurchaseRequestItemDto(i: PrismaPurchaseRequestItem): PurchaseRequestItem {
  return {
    id: i.id,
    productId: i.productId,
    productName: i.productName,
    supplierId: i.supplierId,
    supplierName: i.supplierName,
    quantity: i.quantity,
    unitPrice: Number(i.unitPrice),
  };
}

type PurchaseRequestWithRelations = PrismaPurchaseRequest & {
  items: PrismaPurchaseRequestItem[];
  approvalSteps: (PrismaApprovalStep & { approver?: User | null })[];
  requester: User;
};

export function toPurchaseRequestDto(pr: PurchaseRequestWithRelations): PurchaseRequest {
  return {
    id: pr.id,
    reference: pr.reference,
    companyId: pr.companyId,
    requesterUserId: pr.requesterUserId,
    requesterName: pr.requester.name,
    department: pr.department ?? undefined,
    costCenterId: pr.costCenterId ?? undefined,
    items: pr.items.map(toPurchaseRequestItemDto),
    totalAmount: Number(pr.totalAmount),
    reason: pr.reason,
    attachmentIds: [],
    approvalSteps: pr.approvalSteps.sort((a, b) => a.stepOrder - b.stepOrder).map(toApprovalStepDto),
    status: pr.status,
    createdAt: pr.createdAt.toISOString(),
  };
}

export function toApprovalRuleDto(r: PrismaApprovalRule): ApprovalRule {
  return {
    id: r.id,
    companyId: r.companyId,
    minAmount: Number(r.minAmount),
    maxAmount: r.maxAmount ? Number(r.maxAmount) : undefined,
    requiredApproverRoles: r.requiredApproverRoles,
  };
}
