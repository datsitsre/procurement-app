import type { Delivery, OrderTimelineEvent, Shipment } from '@/types/orders';

/**
 * Fictional order-tracking history (section 28/29) backing the order detail page's timeline,
 * shipment, and delivery panels. Seeded to match the status each demoOrders record already
 * carries - e.g. an order marked SHIPPED here has a timeline that ends at "Shipped", not
 * "Delivered", so the two stay honest with each other.
 */
export const demoOrderTimelineEvents: OrderTimelineEvent[] = [
  // order-10082 - PROCESSING (payment confirmed, supplier confirmed, now being prepared)
  { id: 'ote-1', orderId: 'order-10082', status: 'PENDING', label: 'Order placed', occurredAt: '2026-09-08T10:30:00Z' },
  { id: 'ote-2', orderId: 'order-10082', status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed', occurredAt: '2026-09-08T10:35:00Z' },
  { id: 'ote-3', orderId: 'order-10082', status: 'CONFIRMED', label: 'Supplier confirmed the order', occurredAt: '2026-09-08T14:10:00Z' },
  { id: 'ote-4', orderId: 'order-10082', status: 'PROCESSING', label: 'Preparing shipment', occurredAt: '2026-09-09T09:00:00Z' },

  // order-10081 - SHIPPED
  { id: 'ote-5', orderId: 'order-10081', status: 'PENDING', label: 'Order placed', occurredAt: '2026-09-05T14:00:00Z' },
  { id: 'ote-6', orderId: 'order-10081', status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed', occurredAt: '2026-09-05T14:05:00Z' },
  { id: 'ote-7', orderId: 'order-10081', status: 'CONFIRMED', label: 'Supplier confirmed the order', occurredAt: '2026-09-05T16:30:00Z' },
  { id: 'ote-8', orderId: 'order-10081', status: 'PROCESSING', label: 'Preparing shipment', occurredAt: '2026-09-06T09:00:00Z' },
  { id: 'ote-9', orderId: 'order-10081', status: 'SHIPPED', label: 'Shipped, on the way', occurredAt: '2026-09-08T08:00:00Z' },

  // order-10072 - DELIVERED
  { id: 'ote-10', orderId: 'order-10072', status: 'PENDING', label: 'Order placed', occurredAt: '2026-08-22T09:15:00Z' },
  { id: 'ote-11', orderId: 'order-10072', status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed', occurredAt: '2026-08-22T09:20:00Z' },
  { id: 'ote-12', orderId: 'order-10072', status: 'CONFIRMED', label: 'Supplier confirmed the order', occurredAt: '2026-08-22T13:00:00Z' },
  { id: 'ote-13', orderId: 'order-10072', status: 'PROCESSING', label: 'Preparing shipment', occurredAt: '2026-08-23T09:00:00Z' },
  { id: 'ote-14', orderId: 'order-10072', status: 'SHIPPED', label: 'Shipped, on the way', occurredAt: '2026-08-24T08:00:00Z' },
  { id: 'ote-15', orderId: 'order-10072', status: 'DELIVERED', label: 'Delivered', occurredAt: '2026-08-25T15:40:00Z' },

  // order-10065 - PARTIALLY_DELIVERED (5 of 8 laptops delivered, remainder still in transit)
  { id: 'ote-16', orderId: 'order-10065', status: 'PENDING', label: 'Order placed', occurredAt: '2026-08-11T11:00:00Z' },
  { id: 'ote-17', orderId: 'order-10065', status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed', occurredAt: '2026-08-11T11:05:00Z' },
  { id: 'ote-18', orderId: 'order-10065', status: 'CONFIRMED', label: 'Supplier confirmed the order', occurredAt: '2026-08-11T15:00:00Z' },
  { id: 'ote-19', orderId: 'order-10065', status: 'PROCESSING', label: 'Preparing shipment', occurredAt: '2026-08-12T09:00:00Z' },
  { id: 'ote-20', orderId: 'order-10065', status: 'SHIPPED', label: 'Shipped, on the way', occurredAt: '2026-08-13T08:00:00Z' },
  { id: 'ote-21', orderId: 'order-10065', status: 'PARTIALLY_DELIVERED', label: '5 of 8 items delivered', occurredAt: '2026-08-14T16:00:00Z' },

  // order-10050 - CANCELLED
  { id: 'ote-22', orderId: 'order-10050', status: 'PENDING', label: 'Order placed', occurredAt: '2026-07-28T09:00:00Z' },
  { id: 'ote-23', orderId: 'order-10050', status: 'CANCELLED', label: 'Cancelled - item out of stock at supplier', occurredAt: '2026-07-28T13:00:00Z' },
];

export const demoShipments: Shipment[] = [
  { id: 'ship-1', orderId: 'order-10082', trackingNumber: 'GH-TRK-88213', status: 'PREPARING' },
  { id: 'ship-2', orderId: 'order-10081', trackingNumber: 'GH-TRK-88190', driverName: 'Kwame Owusu', status: 'IN_TRANSIT', dispatchedAt: '2026-09-08T08:00:00Z' },
  { id: 'ship-3', orderId: 'order-10072', trackingNumber: 'GH-TRK-87905', driverName: 'Abena Mensah', status: 'DELIVERED', dispatchedAt: '2026-08-24T08:00:00Z' },
  { id: 'ship-4', orderId: 'order-10065', trackingNumber: 'GH-TRK-87610', driverName: 'Kojo Asante', status: 'DELIVERED', dispatchedAt: '2026-08-13T08:00:00Z' },
  { id: 'ship-5', orderId: 'order-10065', trackingNumber: 'GH-TRK-87611', status: 'IN_TRANSIT', dispatchedAt: '2026-08-15T08:00:00Z' },
];

export const demoDeliveries: Delivery[] = [
  { id: 'del-1', orderId: 'order-10072', shipmentId: 'ship-3', orderItemId: 'oi-3', orderedQty: 6, deliveredQty: 6, deliveredAt: '2026-08-25T15:40:00Z' },
  { id: 'del-2', orderId: 'order-10065', shipmentId: 'ship-4', orderItemId: 'oi-4', orderedQty: 8, deliveredQty: 5, notes: 'Remaining 3 units back-ordered, arriving on the next shipment.', deliveredAt: '2026-08-14T16:00:00Z' },
];
