import { assertPermission, delay, fail, ok } from './base';
import { demoOrders } from '@/lib/demo-data/orders';
import { demoOrderTimelineEvents, demoShipments, demoDeliveries } from '@/lib/demo-data/order-tracking';
import { Permission, type Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';
import type { Delivery, Order, OrderTimelineEvent, PaymentMethod, Shipment } from '@/types/orders';
import type { PurchaseOrder } from '@/types/procurement';

const ORDERS_STORE_KEY = 'procurement.orders.v1.list';
const ORDER_OVERRIDE_KEY = 'procurement.orders.v1.overrides';
const TIMELINE_STORE_KEY = 'procurement.order-timeline.v1.list';
const SHIPMENTS_STORE_KEY = 'procurement.shipments.v1.list';
const SHIPMENT_OVERRIDE_KEY = 'procurement.shipments.v1.overrides';
const DELIVERIES_STORE_KEY = 'procurement.deliveries.v1.list';

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

function readOverrideStore<T>(key: string): Record<UUID, T> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, T>;
  } catch {
    return {};
  }
}

function writeOverride<T extends { id: UUID }>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  const store = readOverrideStore<T>(key);
  store[value.id] = value;
  window.localStorage.setItem(key, JSON.stringify(store));
}

function allOrders(): Order[] {
  const overrides = readOverrideStore<Order>(ORDER_OVERRIDE_KEY);
  const seeded = demoOrders.map((o) => overrides[o.id] ?? o);
  const created = readList<Order>(ORDERS_STORE_KEY).map((o) => overrides[o.id] ?? o);
  return [...seeded, ...created];
}

function allTimelineEvents(): OrderTimelineEvent[] {
  return [...demoOrderTimelineEvents, ...readList<OrderTimelineEvent>(TIMELINE_STORE_KEY)];
}

function allShipments(): Shipment[] {
  const overrides = readOverrideStore<Shipment>(SHIPMENT_OVERRIDE_KEY);
  const seeded = demoShipments.map((s) => overrides[s.id] ?? s);
  const created = readList<Shipment>(SHIPMENTS_STORE_KEY).map((s) => overrides[s.id] ?? s);
  return [...seeded, ...created];
}

function allDeliveries(): Delivery[] {
  return [...demoDeliveries, ...readList<Delivery>(DELIVERIES_STORE_KEY)];
}

/** Every order status the timeline should pass through, in order, once payment succeeds - the
 *  freshly-checked-out order starts at the first two; the rest are added by the supplier's own
 *  fulfillment actions (markProcessing/dispatchOrder/markDelivered) below. */
const INITIAL_TIMELINE_LABELS: { status: OrderTimelineEvent['status']; label: string }[] = [
  { status: 'PENDING', label: 'Order placed' },
  { status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed' },
];

function addTimelineEvent(orderId: UUID, status: OrderTimelineEvent['status'], label: string) {
  appendToList<OrderTimelineEvent>(TIMELINE_STORE_KEY, {
    id: newId('ote'),
    orderId,
    status,
    label,
    occurredAt: new Date().toISOString(),
  });
}

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

  /** Orders a supplier needs to fulfill (section 44) - the supplier-workspace counterpart to
   *  `listOrders`, which is keyed by the *buyer's* company id instead. */
  listOrdersForSupplier(supplierId: UUID): Promise<ServiceResult<Order[]>>;
  /** CONFIRMED -> PROCESSING: the supplier has started preparing the order. */
  markProcessing(orderId: UUID, callerRole: Role): Promise<ServiceResult<Order>>;
  /** PROCESSING -> SHIPPED: hands the order to a driver, moving its shipment to IN_TRANSIT. */
  dispatchOrder(orderId: UUID, driverName: string, callerRole: Role): Promise<ServiceResult<Order>>;
  /** SHIPPED -> DELIVERED: records a full delivery for every line and closes out the
   *  shipment. Partial delivery (section 29) is modeled in the type but not yet exposed as a
   *  supplier action here - a future refinement, not a gap in what's demoed today. */
  markDelivered(orderId: UUID, callerRole: Role): Promise<ServiceResult<Order>>;
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
    return ok(allDeliveries().filter((d) => d.orderId === orderId));
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

  async listOrdersForSupplier(supplierId: UUID): Promise<ServiceResult<Order[]>> {
    await delay(250);
    return ok(allOrders().filter((o) => o.supplierId === supplierId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async markProcessing(orderId: UUID, callerRole: Role): Promise<ServiceResult<Order>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.ORDERS_FULFILL);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const order = allOrders().find((o) => o.id === orderId);
    if (!order) return fail('NOT_FOUND', 'That order could not be found.');
    if (order.status !== 'CONFIRMED') return fail('INVALID_STATE', 'Only a confirmed order can start processing.');

    const updated: Order = { ...order, status: 'PROCESSING' };
    writeOverride(ORDER_OVERRIDE_KEY, updated);
    addTimelineEvent(orderId, 'PROCESSING', 'Preparing shipment');
    return ok(updated);
  }

  async dispatchOrder(orderId: UUID, driverName: string, callerRole: Role): Promise<ServiceResult<Order>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.ORDERS_FULFILL);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const order = allOrders().find((o) => o.id === orderId);
    if (!order) return fail('NOT_FOUND', 'That order could not be found.');
    if (order.status !== 'PROCESSING') return fail('INVALID_STATE', 'Only a processing order can be dispatched.');

    const shipment = allShipments().find((s) => s.orderId === orderId);
    if (shipment) {
      writeOverride(SHIPMENT_OVERRIDE_KEY, { ...shipment, status: 'IN_TRANSIT', driverName: driverName || undefined, dispatchedAt: new Date().toISOString() });
    }

    const updated: Order = { ...order, status: 'SHIPPED' };
    writeOverride(ORDER_OVERRIDE_KEY, updated);
    addTimelineEvent(orderId, 'SHIPPED', 'Shipped, on the way');
    return ok(updated);
  }

  async markDelivered(orderId: UUID, callerRole: Role): Promise<ServiceResult<Order>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.ORDERS_FULFILL);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const order = allOrders().find((o) => o.id === orderId);
    if (!order) return fail('NOT_FOUND', 'That order could not be found.');
    if (order.status !== 'SHIPPED') return fail('INVALID_STATE', 'Only a shipped order can be marked delivered.');

    const shipment = allShipments().find((s) => s.orderId === orderId);
    const now = new Date().toISOString();
    if (shipment) {
      writeOverride(SHIPMENT_OVERRIDE_KEY, { ...shipment, status: 'DELIVERED' });
      for (const item of order.items) {
        appendToList<Delivery>(DELIVERIES_STORE_KEY, {
          id: newId('del'),
          orderId,
          shipmentId: shipment.id,
          orderItemId: item.id,
          orderedQty: item.quantity,
          deliveredQty: item.quantity,
          deliveredAt: now,
        });
      }
    }

    const updated: Order = { ...order, status: 'DELIVERED' };
    writeOverride(ORDER_OVERRIDE_KEY, updated);
    addTimelineEvent(orderId, 'DELIVERED', 'Delivered');
    return ok(updated);
  }
}

export const ordersService: OrdersService = new MockOrdersService();
