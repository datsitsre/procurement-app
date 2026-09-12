import type { ISODateTime, UUID } from './common';

export type NotificationType =
  | 'RFQ_NEW'
  | 'QUOTE_RECEIVED'
  | 'QUOTE_ACCEPTED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_DECIDED'
  | 'PAYMENT_RECEIVED'
  | 'ORDER_SHIPPED'
  | 'DELIVERY_DELAYED'
  | 'INVOICE_DUE'
  | 'LOW_STOCK';

export interface Notification {
  id: UUID;
  userId: UUID;
  type: NotificationType;
  title: string;
  body: string;
  entityId?: UUID;
  entityHref?: string;
  read: boolean;
  createdAt: ISODateTime;
}
