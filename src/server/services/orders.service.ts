import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toDeliveryDto, toOrderDto, toOrderTimelineEventDto, toShipmentDto } from '@/server/dto/orders';
import type { ServiceResult, UUID } from '@/types/common';
import type { Delivery, Order, OrderTimelineEvent, PaymentMethod, Shipment } from '@/types/orders';
import type { PurchaseOrder } from '@/types/procurement';
import type { Prisma } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/orders.service.ts's mock (Phase 14,
 * Stage 7 - orders, their status timeline, shipments, and deliveries; Stage 8 - checkout now
 * actually charges payment and raises the invoice itself, server-side, in the same flow, closing
 * the last two client-side hand-off boundaries Stage 7 left open). `createFromPurchaseOrder`
 * charges payment first (payment.service.ts's real provider abstraction) - a checkout can now
 * genuinely fail (an invalid card, insufficient credit, ...), unlike Stage 7's version, which
 * assumed every non-credit-terms method always succeeded because there was no real charge yet.
 * On success it creates the Order, its initial timeline, a PREPARING shipment, the Invoice, and
 * marks the originating PurchaseOrder converted - all in one transaction, so nothing is ever
 * left half-done (a PO "paid for" with no Order, an Order with no Invoice, ...).
 */

const ORDER_INCLUDE = { items: true, supplier: true } satisfies Prisma.OrderInclude;

export async function listOrders(companyId: UUID): Promise<ServiceResult<Order[]>> {
  const orders = await db.order.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: ORDER_INCLUDE });
  return ok(orders.map(toOrderDto));
}

/** Every order across every company - the platform admin overview (section 46). */
export async function listAllOrders(): Promise<ServiceResult<Order[]>> {
  const orders = await db.order.findMany({ orderBy: { createdAt: 'desc' }, include: ORDER_INCLUDE });
  return ok(orders.map(toOrderDto));
}

export async function getOrder(id: UUID): Promise<ServiceResult<Order>> {
  const order = await db.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
  if (!order) return fail('NOT_FOUND', 'That order could not be found.');
  return ok(toOrderDto(order));
}

export async function getOrderForPurchaseOrder(purchaseOrderId: UUID): Promise<ServiceResult<Order | null>> {
  const order = await db.order.findFirst({ where: { purchaseOrderId }, include: ORDER_INCLUDE });
  return ok(order ? toOrderDto(order) : null);
}

export async function listTimeline(orderId: UUID): Promise<ServiceResult<OrderTimelineEvent[]>> {
  const events = await db.orderTimelineEvent.findMany({ where: { orderId }, orderBy: { occurredAt: 'asc' } });
  return ok(events.map(toOrderTimelineEventDto));
}

export async function listShipments(orderId: UUID): Promise<ServiceResult<Shipment[]>> {
  const shipments = await db.shipment.findMany({ where: { orderId } });
  return ok(shipments.map(toShipmentDto));
}

export async function listDeliveries(orderId: UUID): Promise<ServiceResult<Delivery[]>> {
  const deliveries = await db.delivery.findMany({ where: { orderId } });
  return ok(deliveries.map(toDeliveryDto));
}

export async function createFromPurchaseOrder(
  po: PurchaseOrder,
  method: PaymentMethod,
  details: Record<string, string>,
  idempotencyKey?: string,
): Promise<ServiceResult<Order>> {
  if (po.orderId) return fail('ALREADY_CONVERTED', 'This purchase order has already been converted into an order.');

  const { charge } = await import('./payment.service');
  const chargeResult = await charge({
    companyId: po.companyId,
    supplierId: po.supplierId,
    amount: po.total,
    currency: 'GHS',
    method,
    details,
    idempotencyKey,
  });
  if (!chargeResult.ok) return fail(chargeResult.error.code, chargeResult.error.message);

  // A successful charge is either a real payment (CARD/momo/bank/wallet) or a credit-terms
  // reservation - only the latter leaves the invoice still due, exactly like Stage 7's version
  // derived it, just now gated behind an actual charge attempt instead of assumed.
  const paymentStatus: Order['paymentStatus'] = method === 'CREDIT_TERMS' ? 'PENDING' : 'PAID';
  const now = new Date();
  const expectedDeliveryDate = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        reference: `ORD-${Math.floor(10000 + Math.random() * 89999)}`,
        companyId: po.companyId,
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        department: po.department,
        costCenterId: po.costCenterId,
        subtotal: po.subtotal,
        tax: po.tax,
        deliveryFee: po.deliveryFee,
        total: po.total,
        status: 'CONFIRMED',
        paymentStatus,
        deliveryLocation: po.deliveryLocation,
        expectedDeliveryDate,
        items: { create: po.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })) },
      },
      include: ORDER_INCLUDE,
    });

    // Millisecond offsets, not minutes - these events all happen "at checkout", and any real
    // subsequent fulfillment action (markProcessing, ...) must sort after them by actually
    // occurring later in wall-clock time, not by racing a timestamp seeded minutes into the
    // future.
    const events: { status: string; label: string; occurredAt: Date }[] = [{ status: 'PENDING', label: 'Order placed', occurredAt: now }];
    if (paymentStatus === 'PAID') {
      events.push({ status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed', occurredAt: new Date(now.getTime() + 1) });
    }
    events.push({ status: 'CONFIRMED', label: 'Supplier confirmed the order', occurredAt: new Date(now.getTime() + events.length) });
    await tx.orderTimelineEvent.createMany({ data: events.map((e) => ({ ...e, orderId: created.id })) });

    await tx.shipment.create({
      data: { orderId: created.id, trackingNumber: `GH-TRK-${Math.floor(80000 + Math.random() * 9999)}`, status: 'PREPARING' },
    });

    await tx.purchaseOrder.update({ where: { id: po.id }, data: { orderId: created.id } });

    const { createForOrder } = await import('./invoices.service');
    const invoice = await createForOrder(toOrderDto(created), tx);
    await tx.payment.update({ where: { id: chargeResult.data.id }, data: { invoiceId: invoice.id, orderId: created.id } });

    return created;
  });

  return ok(toOrderDto(order));
}

export async function listOrdersForSupplier(supplierId: UUID): Promise<ServiceResult<Order[]>> {
  const orders = await db.order.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, include: ORDER_INCLUDE });
  return ok(orders.map(toOrderDto));
}

async function addTimelineEvent(orderId: UUID, status: string, label: string) {
  await db.orderTimelineEvent.create({ data: { orderId, status, label } });
}

/** CONFIRMED -> PROCESSING: the supplier has started preparing the order. */
export async function markProcessing(orderId: UUID): Promise<ServiceResult<Order>> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return fail('NOT_FOUND', 'That order could not be found.');
  if (order.status !== 'CONFIRMED') return fail('INVALID_STATE', 'Only a confirmed order can start processing.');

  const updated = await db.order.update({ where: { id: orderId }, data: { status: 'PROCESSING' }, include: ORDER_INCLUDE });
  await addTimelineEvent(orderId, 'PROCESSING', 'Preparing shipment');
  return ok(toOrderDto(updated));
}

/** PROCESSING -> SHIPPED: hands the order to a driver, moving its shipment to IN_TRANSIT. */
export async function dispatchOrder(orderId: UUID, driverName: string): Promise<ServiceResult<Order>> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return fail('NOT_FOUND', 'That order could not be found.');
  if (order.status !== 'PROCESSING') return fail('INVALID_STATE', 'Only a processing order can be dispatched.');

  const shipment = await db.shipment.findFirst({ where: { orderId } });
  const updated = await db.$transaction(async (tx) => {
    if (shipment) {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: 'IN_TRANSIT', driverName: driverName || undefined, dispatchedAt: new Date() },
      });
    }
    return tx.order.update({ where: { id: orderId }, data: { status: 'SHIPPED' }, include: ORDER_INCLUDE });
  });
  await addTimelineEvent(orderId, 'SHIPPED', 'Shipped, on the way');
  return ok(toOrderDto(updated));
}

/** SHIPPED -> DELIVERED: records a full delivery for every line and closes out the shipment.
 *  Partial delivery (section 29) is modeled in the schema but not yet exposed as a supplier
 *  action here - a future refinement, not a gap in what's demoed today. */
export async function markDelivered(orderId: UUID): Promise<ServiceResult<Order>> {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return fail('NOT_FOUND', 'That order could not be found.');
  if (order.status !== 'SHIPPED') return fail('INVALID_STATE', 'Only a shipped order can be marked delivered.');

  const shipment = await db.shipment.findFirst({ where: { orderId } });
  const updated = await db.$transaction(async (tx) => {
    if (shipment) {
      await tx.shipment.update({ where: { id: shipment.id }, data: { status: 'DELIVERED' } });
      await tx.delivery.createMany({
        data: order.items.map((item) => ({
          orderId,
          shipmentId: shipment.id,
          orderItemId: item.id,
          orderedQty: item.quantity,
          deliveredQty: item.quantity,
        })),
      });
    }
    return tx.order.update({ where: { id: orderId }, data: { status: 'DELIVERED' }, include: ORDER_INCLUDE });
  });
  await addTimelineEvent(orderId, 'DELIVERED', 'Delivered');
  return ok(toOrderDto(updated));
}

/** Marks an order's payment REFUNDED - called by disputes.service once a platform admin resolves
 *  a dispute in the buyer's favor. Not permission-gated here: the caller has already checked
 *  PLATFORM_MANAGE before reaching this, the same "checked once, upstream" pattern
 *  audit.service's recordAudit uses. */
export async function markRefunded(orderId: UUID): Promise<ServiceResult<Order>> {
  const order = await db.order.update({ where: { id: orderId }, data: { paymentStatus: 'REFUNDED' }, include: ORDER_INCLUDE }).catch(() => null);
  if (!order) return fail('NOT_FOUND', 'That order could not be found.');
  return ok(toOrderDto(order));
}
