import type { ISODateTime, UUID } from './common';
import type { ApprovalStatus, PurchaseRequestStatus, RfqStatus } from './status';

// ---------- RFQ (Request for Quotation) ----------

export interface RFQItem {
  id: UUID;
  productId: UUID;
  productName: string;
  quantity: number;
}

/** Tracks one supplier's participation in an RFQ, independent of whether they've quoted yet -
 *  this is what drives "3 suppliers invited / 2 responded" counts in the RFQ list. */
export interface RFQSupplier {
  supplierId: UUID;
  supplierName: string;
  status: 'INVITED' | 'VIEWED' | 'QUOTED' | 'DECLINED';
}

export interface RFQ {
  id: UUID;
  reference: string;
  companyId: UUID;
  createdByUserId: UUID;
  items: RFQItem[];
  requiredDeliveryDate: ISODateTime;
  deliveryLocation: string;
  additionalRequirements?: string;
  attachmentIds: UUID[];
  suppliers: RFQSupplier[];
  status: RfqStatus;
  createdAt: ISODateTime;
  expiresAt?: ISODateTime;
}

// ---------- Quote (a supplier's response to an RFQ) ----------

export interface QuoteItem {
  id: UUID;
  productId: UUID;
  quantity: number;
  unitPrice: number;
}

export interface Quote {
  id: UUID;
  rfqId: UUID;
  supplierId: UUID;
  supplierName: string;
  items: QuoteItem[];
  totalPrice: number;
  deliveryDays: number;
  warrantyMonths: number;
  notes?: string;
  submittedAt: ISODateTime;
}

// ---------- Negotiation ----------

export interface NegotiationMessage {
  id: UUID;
  rfqId: UUID;
  quoteId: UUID;
  senderRole: 'BUYER' | 'SUPPLIER';
  senderName: string;
  message: string;
  proposedPrice?: number;
  proposedQuantity?: number;
  /** Negotiation history is append-only - see section 20: "Do not allow users to alter
   *  historical messages." No update/delete method exists on the negotiation service. */
  sentAt: ISODateTime;
}

// ---------- Purchase Request + Approval workflow ----------

export interface ApprovalStep {
  id: UUID;
  stepOrder: number;
  approverRole: string;
  approverName?: string;
  status: ApprovalStatus;
  decidedAt?: ISODateTime;
  comment?: string;
}

/** A configurable spend-based approval rule - section 23. Admin-editable per company. */
export interface ApprovalRule {
  id: UUID;
  companyId: UUID;
  minAmount: number;
  maxAmount?: number;
  requiredApproverRoles: string[];
}

/** A snapshot of one cart line at the moment a purchase request was submitted - the cart
 *  itself is mutable (and gets cleared after submission), so the request needs its own copy
 *  of what was actually requested, not a live reference back to the cart. */
export interface PurchaseRequestItem {
  id: UUID;
  productId: UUID;
  productName: string;
  supplierId: UUID;
  supplierName: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseRequest {
  id: UUID;
  reference: string;
  companyId: UUID;
  requesterUserId: UUID;
  requesterName: string;
  department?: string;
  items: PurchaseRequestItem[];
  totalAmount: number;
  reason: string;
  attachmentIds: UUID[];
  approvalSteps: ApprovalStep[];
  status: PurchaseRequestStatus;
  createdAt: ISODateTime;
}

// ---------- Purchase Order ----------

export interface PurchaseOrderItem {
  id: UUID;
  productId: UUID;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrder {
  id: UUID;
  reference: string;
  companyId: UUID;
  supplierId: UUID;
  supplierName: string;
  purchaseRequestId?: UUID;
  items: PurchaseOrderItem[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  total: number;
  paymentTerms: string;
  deliveryLocation: string;
  authorizedByName: string;
  createdAt: ISODateTime;
}
