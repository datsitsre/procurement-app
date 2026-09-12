import type { ISODateTime, UUID } from './common';
import type { InvoiceStatus, OrderStatus, PaymentStatus } from './status';

export interface OrderItem {
  id: UUID;
  productId: UUID;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: UUID;
  reference: string;
  companyId: UUID;
  supplierId: UUID;
  supplierName: string;
  purchaseOrderId?: UUID;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryLocation: string;
  expectedDeliveryDate?: ISODateTime;
  createdAt: ISODateTime;
}

/** One order-status change, driving the order tracking timeline (section 28). */
export interface OrderTimelineEvent {
  id: UUID;
  orderId: UUID;
  status: OrderStatus | 'PAYMENT_CONFIRMED';
  label: string;
  occurredAt: ISODateTime;
}

export interface Shipment {
  id: UUID;
  orderId: UUID;
  trackingNumber: string;
  driverName?: string;
  status: 'PREPARING' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED';
  dispatchedAt?: ISODateTime;
}

/** Supports partial deliveries (section 29): `deliveredQty` can be less than the order line's
 *  ordered quantity, with further Delivery records added later for the remainder. */
export interface Delivery {
  id: UUID;
  orderId: UUID;
  shipmentId: UUID;
  orderItemId: UUID;
  orderedQty: number;
  deliveredQty: number;
  proofOfDeliveryUrl?: string;
  notes?: string;
  deliveredAt: ISODateTime;
}

export interface InvoiceItem {
  id: UUID;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: UUID;
  reference: string;
  companyId: UUID;
  supplierId: UUID;
  supplierName: string;
  orderId?: UUID;
  purchaseOrderReference?: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  status: InvoiceStatus;
  dueDate: ISODateTime;
  issuedAt: ISODateTime;
}

export type PaymentMethod =
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'MTN_MOMO'
  | 'TELECEL_CASH'
  | 'AIRTELTIGO_MONEY'
  | 'WALLET'
  | 'CREDIT_TERMS';

export interface Payment {
  id: UUID;
  companyId: UUID;
  /** Who was paid - set directly at charge time so supplier payment history doesn't depend on
   *  an invoice/order having been created yet (checkout charges before either exists). */
  supplierId?: UUID;
  invoiceId?: UUID;
  orderId?: UUID;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  createdAt: ISODateTime;
}

export interface Dispute {
  id: UUID;
  orderId: UUID;
  companyId: UUID;
  reason: string;
  description: string;
  evidenceUrls: string[];
  status: string;
  createdAt: ISODateTime;
}
