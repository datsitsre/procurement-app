import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toPurchaseOrderDto } from '@/server/dto/orders';
import type { ServiceResult, UUID } from '@/types/common';
import type { PurchaseOrder, PurchaseRequest, Quote, RFQ } from '@/types/procurement';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/purchase-order.service.ts's mock (Phase
 * 14, Stage 7). `createFromQuote`/`createFromPurchaseRequest` are called internally by
 * procurement.service.ts's own acceptQuote/decideStep - the same "one domain calls into
 * another's server module directly, never duplicates its logic" pattern the client mocks used,
 * now finally closing the boundary Stage 5/6 deliberately left at the client (accepting a quote
 * or approving a request produces a real PurchaseOrder in the same request, not a follow-up
 * client-side mock call).
 */

const PURCHASE_ORDER_INCLUDE = { items: true, supplier: true } satisfies Prisma.PurchaseOrderInclude;

function poReference(): string {
  return `PO-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 89999)).slice(0, 5)}`;
}

export async function listPurchaseOrders(companyId: UUID): Promise<ServiceResult<PurchaseOrder[]>> {
  const pos = await db.purchaseOrder.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: PURCHASE_ORDER_INCLUDE });
  return ok(pos.map(toPurchaseOrderDto));
}

export async function getPurchaseOrder(id: UUID): Promise<ServiceResult<PurchaseOrder>> {
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: PURCHASE_ORDER_INCLUDE });
  if (!po) return fail('NOT_FOUND', 'That purchase order could not be found.');
  return ok(toPurchaseOrderDto(po));
}

export async function listForPurchaseRequest(purchaseRequestId: UUID): Promise<ServiceResult<PurchaseOrder[]>> {
  const pos = await db.purchaseOrder.findMany({ where: { purchaseRequestId }, include: PURCHASE_ORDER_INCLUDE });
  return ok(pos.map(toPurchaseOrderDto));
}

/** Builds and persists a PurchaseOrder from an accepted RFQ quote (section 24) - called by
 *  procurement.service.ts's acceptQuote once it has updated the RFQ/Quote side, inside the same
 *  transaction (`client`, defaulting to the plain `db` handle for any other caller) - so a
 *  failure creating the PO can never leave the RFQ stuck ACCEPTED with no purchase order to show
 *  for it (section 12/25's transaction-atomicity requirement). */
export async function createFromQuote(
  rfq: RFQ,
  quote: Quote,
  authorizedByName: string,
  client: Prisma.TransactionClient | PrismaClient = db,
): Promise<PurchaseOrder> {
  const { FLAT_DELIVERY_FEE, calculateTax } = await import('@/utils/pricing');
  const subtotal = quote.totalPrice;
  const tax = calculateTax(subtotal);

  const po = await client.purchaseOrder.create({
    data: {
      reference: poReference(),
      companyId: rfq.companyId,
      supplierId: quote.supplierId,
      subtotal,
      tax,
      deliveryFee: FLAT_DELIVERY_FEE,
      total: subtotal + tax + FLAT_DELIVERY_FEE,
      paymentTerms: 'Net 30',
      deliveryLocation: rfq.deliveryLocation,
      authorizedByName,
      items: {
        create: quote.items.map((qi) => {
          const rfqItem = rfq.items.find((i) => i.productId === qi.productId);
          return { productId: qi.productId, productName: rfqItem?.productName ?? qi.productId, quantity: qi.quantity, unitPrice: qi.unitPrice };
        }),
      },
    },
    include: PURCHASE_ORDER_INCLUDE,
  });
  return toPurchaseOrderDto(po);
}

/** Builds one PurchaseOrder per distinct supplier represented in a fully-approved purchase
 *  request's items (section 64: "Approved -> Create PO") - called by procurement.service.ts's
 *  decideStep once every approval step is APPROVED, inside the same transaction (`client`,
 *  defaulting to the plain `db` handle for any other caller) - so a failure partway through
 *  creating these can never leave the request stuck CONVERTED_TO_PO with fewer POs than
 *  suppliers represented in it (section 12/25's transaction-atomicity requirement). */
export async function createFromPurchaseRequest(
  pr: PurchaseRequest,
  authorizedByName: string,
  client: Prisma.TransactionClient | PrismaClient = db,
): Promise<PurchaseOrder[]> {
  const { FLAT_DELIVERY_FEE, calculateTax } = await import('@/utils/pricing');

  const company = await client.company.findUnique({ where: { id: pr.companyId }, include: { addresses: true } });
  const paymentTerms = company ? company.creditTerms.replace('_', ' ') : 'Net 30';
  const deliveryLocation = company?.addresses.find((a) => a.isDefault)?.line1 ?? 'Company warehouse';

  const bySupplier = new Map<string, typeof pr.items>();
  for (const item of pr.items) {
    bySupplier.set(item.supplierId, [...(bySupplier.get(item.supplierId) ?? []), item]);
  }

  const created: PurchaseOrder[] = [];
  for (const [supplierId, items] of bySupplier) {
    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const tax = calculateTax(subtotal);
    const po = await client.purchaseOrder.create({
      data: {
        reference: poReference(),
        companyId: pr.companyId,
        supplierId,
        purchaseRequestId: pr.id,
        department: pr.department,
        costCenterId: pr.costCenterId,
        subtotal,
        tax,
        deliveryFee: FLAT_DELIVERY_FEE,
        total: subtotal + tax + FLAT_DELIVERY_FEE,
        paymentTerms,
        deliveryLocation,
        authorizedByName,
        items: { create: items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })) },
      },
      include: PURCHASE_ORDER_INCLUDE,
    });
    created.push(toPurchaseOrderDto(po));
  }
  return created;
}

/** Records that checkout (section 25) has turned this PO into a real order - called by the
 *  checkout route right after orders.service creates the Order, in the same transaction. */
export async function markConverted(purchaseOrderId: UUID, orderId: UUID): Promise<ServiceResult<PurchaseOrder>> {
  const po = await db.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { orderId }, include: PURCHASE_ORDER_INCLUDE }).catch(() => null);
  if (!po) return fail('NOT_FOUND', 'That purchase order could not be found.');
  return ok(toPurchaseOrderDto(po));
}
