/**
 * Centralized status constants for the platform's core workflows. Every status string used
 * anywhere in the app (UI labels, filters, API payloads, mock services) must come from one of
 * these objects - never scatter raw string literals like "pending" or "shipped" across
 * components, since that's how status typos and drift between frontend/backend creep in.
 */

export const OrderStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  PARTIALLY_DELIVERED: 'PARTIALLY_DELIVERED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const RfqStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  VIEWED: 'VIEWED',
  QUOTED: 'QUOTED',
  NEGOTIATION: 'NEGOTIATION',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type RfqStatus = (typeof RfqStatus)[keyof typeof RfqStatus];

export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const PurchaseRequestStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  IN_APPROVAL: 'IN_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CONVERTED_TO_PO: 'CONVERTED_TO_PO',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseRequestStatus = (typeof PurchaseRequestStatus)[keyof typeof PurchaseRequestStatus];

export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  VOID: 'VOID',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const SupplierVerificationStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  VERIFIED: 'VERIFIED',
  PREMIUM_VERIFIED: 'PREMIUM_VERIFIED',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
} as const;
export type SupplierVerificationStatus =
  (typeof SupplierVerificationStatus)[keyof typeof SupplierVerificationStatus];

export const DisputeStatus = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  AWAITING_EVIDENCE: 'AWAITING_EVIDENCE',
  RESOLVED_REFUND: 'RESOLVED_REFUND',
  RESOLVED_REJECTED: 'RESOLVED_REJECTED',
  CLOSED: 'CLOSED',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

/** Shared shape for rendering any of the above through a single <StatusBadge> component. */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const orderTones: Record<OrderStatus, StatusTone> = {
  PENDING: 'neutral',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  PARTIALLY_DELIVERED: 'warning',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

const paymentTones: Record<PaymentStatus, StatusTone> = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  PAID: 'success',
  FAILED: 'danger',
  REFUNDED: 'warning',
};

const rfqTones: Record<RfqStatus, StatusTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  VIEWED: 'info',
  QUOTED: 'info',
  NEGOTIATION: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
};

const approvalTones: Record<ApprovalStatus, StatusTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const purchaseRequestTones: Record<PurchaseRequestStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  IN_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CONVERTED_TO_PO: 'success',
  CANCELLED: 'danger',
};

const invoiceTones: Record<InvoiceStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING: 'warning',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  VOID: 'neutral',
};

const supplierVerificationTones: Record<SupplierVerificationStatus, StatusTone> = {
  PENDING_VERIFICATION: 'warning',
  VERIFIED: 'success',
  PREMIUM_VERIFIED: 'success',
  SUSPENDED: 'danger',
  REJECTED: 'danger',
};

const disputeTones: Record<DisputeStatus, StatusTone> = {
  OPEN: 'warning',
  UNDER_REVIEW: 'info',
  AWAITING_EVIDENCE: 'warning',
  RESOLVED_REFUND: 'success',
  RESOLVED_REJECTED: 'neutral',
  CLOSED: 'neutral',
};

/** Human-readable labels, e.g. "PARTIALLY_DELIVERED" -> "Partially delivered". */
function titleCase(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Status values plain title-casing gets wrong - just the ones with an embedded acronym
 *  ("PO" -> "Po", not "PO"). Spelled out rather than kept as an acronym ("Converted to PO"),
 *  matching the rest of the app's own vocabulary - the nav says "Purchase orders", never "POs". */
const STATUS_LABEL_OVERRIDES: Record<string, string> = {
  CONVERTED_TO_PO: 'Converted to purchase order',
};

export const statusToneMaps = {
  order: orderTones,
  payment: paymentTones,
  rfq: rfqTones,
  approval: approvalTones,
  purchaseRequest: purchaseRequestTones,
  invoice: invoiceTones,
  supplierVerification: supplierVerificationTones,
  dispute: disputeTones,
} as const;

export type StatusDomain = keyof typeof statusToneMaps;

export function getStatusTone(domain: StatusDomain, status: string): StatusTone {
  const map = statusToneMaps[domain] as Record<string, StatusTone>;
  return map[status] ?? 'neutral';
}

export function getStatusLabel(status: string): string {
  return STATUS_LABEL_OVERRIDES[status] ?? titleCase(status);
}
