import { delay, fail, ok } from './base';
import { demoOrders } from '@/lib/demo-data/orders';
import { demoOrderTimelineEvents, demoShipments, demoDeliveries } from '@/lib/demo-data/order-tracking';
import type { ServiceResult, UUID } from '@/types/common';
import type { Delivery, Order, OrderTimelineEvent, PaymentMethod, Shipment } from '@/types/orders';
import type { PurchaseOrder } from '@/types/procurement';

const ORDERS_STORE_KEY = 'procurement.orders.v1.list';
const TIMELINE_STORE_KEY = 'procurement.order-timeline.v1.list';
const SHIPMENTS_STORE_KEY = 'procurement.shipments.v1.list';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function readList<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

function appendToList<T>(key: string, item: T) {
  if (typeof window === 'undefined') return;
  const list = readList<T>(key);
  list.push(item);
  window.localStorage.setItem(key, JSON.stringify(list));
}

function allOrders(): Order[] {
  return [...demoOrders, ...readList<Order>(ORDERS_STORE_KEY)];
}

function allTimelineEvents(): OrderTimelineEvent[] {
  return [...demoOrderTimelineEvents, ...readList<OrderTimelineEvent>(TIMELINE_STORE_KEY)];
}

function allShipments(): Shipment[] {
  return [...demoShipments, ...readList<Shipment>(SHIPMENTS_STORE_KEY)];
}

/** Every order status the timeline should pass through, in order, once payment succeeds -
 *  the freshly-checked-out order starts at the first two and advances no further until a
 *  (currently out of scope - Phase 5) supplier or logistics action moves it along. */
const INITIAL_TIMELINE_LABELS: { status: OrderTimelineEvent['status']; label: string }[] = [
  { status: 'PENDING', label: 'Order placed' },
  { status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed' },
];

export interface OrdersService {
  listOrders(companyId: UUID): Promise<ServiceResult<Order[]>>;
  getOrder(id: UUID): Promise<ServiceResult<Order>>;
  getOrderForPurchaseOrder(purchaseOrderId: UUID): Promise<ServiceResult<Order | null>>;
  listTimeline(orderId: UUID): Promise<ServiceResult<OrderTimelineEvent[]>>;
  listShipments(orderId: UUID): Promise<ServiceResult<Shipment[]>>;
  listDeliveries(orderId: UUID): Promise<ServiceResult<Delivery[]>>;
  /** Turns a paid-for purchase order into a real order (section 25's checkout confirmation
   *  step) - called by the checkout flow once payment succeeds. Credit-terms checkouts pass
   *  paymentStatus: 'PENDING' since the invoice stays due rather than being paid up front. */
  createFromPurchaseOrder(po: PurchaseOrder, method: PaymentMethod, paymentStatus: Order['paymentStatus']): Promise<Order>;
}

class MockOrdersService implements OrdersService {
  async listOrders(companyId: UUID): Promise<ServiceResult<Order[]>> {
    await delay(250);
    return ok(allOrders().filter((o) => o.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async getOrder(id: UUID): Promise<ServiceResult<Order>> {
    await delay(200);
    const order = allOrders().find((o) => o.id === id);
    if (!order) return fail('NOT_FOUND', 'That order could not be found.');
    return ok(order);
  }

  async getOrderForPurchaseOrder(purchaseOrderId: UUID): Promise<ServiceResult<Order | null>> {
    await delay(150);
    return ok(allOrders().find((o) => o.purchaseOrderId === purchaseOrderId) ?? null);
  }

  async listTimeline(orderId: UUID): Promise<ServiceResult<OrderTimelineEvent[]>> {
    await delay(200);
    return ok(allTimelineEvents().filter((e) => e.orderId === orderId).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1)));
  }

  async listShipments(orderId: UUID): Promise<ServiceResult<Shipment[]>> {
    await delay(200);
    return ok(allShipments().filter((s) => s.orderId === orderId));
  }

  async listDeliveries(orderId: UUID): Promise<ServiceResult<Delivery[]>> {
    await delay(200);
    return ok(demoDeliveries.filter((d) => d.orderId === orderId));
  }

  async createFromPurchaseOrder(po: PurchaseOrder, method: PaymentMethod, paymentStatus: Order['paymentStatus']): Promise<Order> {
    await delay(300);
    const now = new Date();
    const expectedDeliveryDate = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();

    const order: Order = {
      id: newId('order'),
      reference: `ORD-${Math.floor(10000 + Math.random() * 89999)}`,
      companyId: po.companyId,
      supplierId: po.supplierId,
      supplierName: po.supplierName,
      purchaseOrderId: po.id,
      items: po.items.map((i) => ({ id: newId('oi'), productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })),
      subtotal: po.subtotal,
      tax: po.tax,
      deliveryFee: po.deliveryFee,
      total: po.total,
      status: 'CONFIRMED',
      paymentStatus,
      deliveryLocation: po.deliveryLocation,
      expectedDeliveryDate,
      createdAt: now.toISOString(),
    };
    appendToList(ORDERS_STORE_KEY, order);

    const events: OrderTimelineEvent[] = INITIAL_TIMELINE_LABELS.filter(
      (e) => e.status !== 'PAYMENT_CONFIRMED' || paymentStatus === 'PAID',
    ).map((e, i) => ({
      id: newId('ote'),
      orderId: order.id,
      status: e.status,
      label: e.label,
      occurredAt: new Date(now.getTime() + i * 60000).toISOString(),
    }));
    events.push({
      id: newId('ote'),
      orderId: order.id,
      status: 'CONFIRMED',
      label: 'Supplier confirmed the order',
      occurredAt: new Date(now.getTime() + events.length * 60000).toISOString(),
    });
    for (const event of events) appendToList(TIMELINE_STORE_KEY, event);

    appendToList<Shipment>(SHIPMENTS_STORE_KEY, {
      id: newId('ship'),
      orderId: order.id,
      trackingNumber: `GH-TRK-${Math.floor(80000 + Math.random() * 9999)}`,
      status: 'PREPARING',
    });

    return order;
  }
}

export const ordersService: OrdersService = new MockOrdersService();
