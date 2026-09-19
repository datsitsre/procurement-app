import 'server-only';
import type { Cart, CartItem } from '@/types/cart';
import type { Delivery, Dispute, Order, OrderItem, OrderTimelineEvent, Shipment } from '@/types/orders';
import type { PurchaseOrder, PurchaseOrderItem } from '@/types/procurement';
import type {
  Cart as PrismaCart,
  CartItem as PrismaCartItem,
  Delivery as PrismaDelivery,
  Dispute as PrismaDispute,
  Order as PrismaOrder,
  OrderItem as PrismaOrderItem,
  OrderTimelineEvent as PrismaOrderTimelineEvent,
  PurchaseOrder as PrismaPurchaseOrder,
  PurchaseOrderItem as PrismaPurchaseOrderItem,
  Shipment as PrismaShipment,
  SupplierProfile,
} from '@prisma/client';

/** Maps Prisma's generated Cart/PurchaseOrder/Order/Dispute models to the exact frontend types
 *  (src/types/{cart,orders,procurement}.ts) - Decimal -> number, Date -> ISO string, null ->
 *  undefined, and (since neither PurchaseOrder nor Order stores a supplier *name* column) a
 *  joined SupplierProfile for the one field that needs it, never a raw ORM entity crossing the
 *  API boundary. */

export function toCartItemDto(i: PrismaCartItem): CartItem {
  return { id: i.id, productId: i.productId, supplierId: i.supplierId, quantity: i.quantity, unitPrice: Number(i.unitPrice) };
}

export function toCartDto(c: PrismaCart & { items: PrismaCartItem[] }): Cart {
  return { id: c.id, companyId: c.companyId, items: c.items.map(toCartItemDto) };
}

export function toPurchaseOrderItemDto(i: PrismaPurchaseOrderItem): PurchaseOrderItem {
  return { id: i.id, productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: Number(i.unitPrice) };
}

type PurchaseOrderWithRelations = PrismaPurchaseOrder & { items: PrismaPurchaseOrderItem[]; supplier: SupplierProfile };

export function toPurchaseOrderDto(po: PurchaseOrderWithRelations): PurchaseOrder {
  return {
    id: po.id,
    reference: po.reference,
    companyId: po.companyId,
    supplierId: po.supplierId,
    supplierName: po.supplier.name,
    purchaseRequestId: po.purchaseRequestId ?? undefined,
    department: po.department ?? undefined,
    costCenterId: po.costCenterId ?? undefined,
    items: po.items.map(toPurchaseOrderItemDto),
    subtotal: Number(po.subtotal),
    tax: Number(po.tax),
    deliveryFee: Number(po.deliveryFee),
    total: Number(po.total),
    paymentTerms: po.paymentTerms,
    deliveryLocation: po.deliveryLocation,
    authorizedByName: po.authorizedByName,
    orderId: po.orderId ?? undefined,
    createdAt: po.createdAt.toISOString(),
  };
}

export function toOrderItemDto(i: PrismaOrderItem): OrderItem {
  return { id: i.id, productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: Number(i.unitPrice) };
}

type OrderWithRelations = PrismaOrder & { items: PrismaOrderItem[]; supplier: SupplierProfile };

export function toOrderDto(o: OrderWithRelations): Order {
  return {
    id: o.id,
    reference: o.reference,
    companyId: o.companyId,
    supplierId: o.supplierId,
    supplierName: o.supplier.name,
    purchaseOrderId: o.purchaseOrderId ?? undefined,
    department: o.department ?? undefined,
    costCenterId: o.costCenterId ?? undefined,
    items: o.items.map(toOrderItemDto),
    subtotal: Number(o.subtotal),
    tax: Number(o.tax),
    deliveryFee: Number(o.deliveryFee),
    total: Number(o.total),
    status: o.status,
    paymentStatus: o.paymentStatus,
    deliveryLocation: o.deliveryLocation,
    expectedDeliveryDate: o.expectedDeliveryDate?.toISOString(),
    createdAt: o.createdAt.toISOString(),
  };
}

export function toOrderTimelineEventDto(e: PrismaOrderTimelineEvent): OrderTimelineEvent {
  return { id: e.id, orderId: e.orderId, status: e.status as OrderTimelineEvent['status'], label: e.label, occurredAt: e.occurredAt.toISOString() };
}

export function toShipmentDto(s: PrismaShipment): Shipment {
  return {
    id: s.id,
    orderId: s.orderId,
    trackingNumber: s.trackingNumber,
    driverName: s.driverName ?? undefined,
    status: s.status,
    dispatchedAt: s.dispatchedAt?.toISOString(),
  };
}

export function toDeliveryDto(d: PrismaDelivery): Delivery {
  return {
    id: d.id,
    orderId: d.orderId,
    shipmentId: d.shipmentId,
    orderItemId: d.orderItemId,
    orderedQty: d.orderedQty,
    deliveredQty: d.deliveredQty,
    proofOfDeliveryUrl: d.proofOfDeliveryUrl ?? undefined,
    notes: d.notes ?? undefined,
    deliveredAt: d.deliveredAt.toISOString(),
  };
}

export function toDisputeDto(d: PrismaDispute & { order: PrismaOrder }): Dispute {
  return {
    id: d.id,
    orderId: d.orderId,
    // Dispute doesn't store its own reference column - it's derived from the order at read
    // time, the same "denormalized field via join, never a raw ORM entity" pattern every other
    // DTO here uses (see toRfqSupplierDto's supplierName, for one).
    orderReference: d.order.reference,
    companyId: d.companyId,
    supplierId: d.supplierId,
    reason: d.reason,
    description: d.description,
    evidenceUrls: d.evidenceUrls,
    status: d.status,
    resolutionNote: d.resolutionNote ?? undefined,
    createdAt: d.createdAt.toISOString(),
    resolvedAt: d.resolvedAt?.toISOString(),
  };
}
