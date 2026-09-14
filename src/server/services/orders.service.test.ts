// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { toPurchaseOrderDto } from '@/server/dto/orders';
import {
  createFromPurchaseOrder,
  dispatchOrder,
  getOrder,
  listDeliveries,
  listShipments,
  listTimeline,
  markDelivered,
  markProcessing,
  markRefunded,
} from './orders.service';

/**
 * Phase 14, Stage 7 - real, database-backed regression suite for orders: checkout confirmation,
 * the fulfillment state machine, and refunds. Runs against the actual dev Postgres database,
 * scoped to a dedicated test company/supplier/category/product this suite creates and cleans up
 * in `afterAll` - never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-orders-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-orders-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-orders-${Date.now()}`;
const TEST_PRODUCT_ID = `test-product-orders-${Date.now()}`;

async function createScratchPurchaseOrder() {
  const po = await db.purchaseOrder.create({
    data: {
      reference: `PO-TEST-${Date.now()}-${Math.random()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      deliveryFee: 2000,
      total: 3125,
      paymentTerms: 'Net 30',
      deliveryLocation: 'Accra',
      authorizedByName: 'Test Buyer',
      items: { create: [{ productId: TEST_PRODUCT_ID, productName: 'Orders Test Widget', quantity: 1, unitPrice: 1000 }] },
    },
    include: { items: true, supplier: true },
  });
  return toPurchaseOrderDto(po);
}

const VALID_CARD = { cardNumber: '4111111111111111', cvv: '123' };

beforeAll(async () => {
  await db.company.create({
    data: { id: TEST_COMPANY_ID, name: 'Orders Test Buyer Co', country: 'GH', currency: 'GHS', creditAvailable: 100000 },
  });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Orders Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Orders Test Supplier',
      slug: `orders-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Orders Test Category', slug: `orders-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: TEST_PRODUCT_ID,
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Orders Test Widget',
      slug: `orders-test-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 1000,
      moq: 1,
    },
  });
});

afterAll(async () => {
  await db.paymentTransaction.deleteMany({ where: { payment: { companyId: TEST_COMPANY_ID } } });
  await db.payment.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.invoiceItem.deleteMany({ where: { invoice: { companyId: TEST_COMPANY_ID } } });
  await db.invoice.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.delivery.deleteMany({ where: { orderId: { in: await db.order.findMany({ where: { companyId: TEST_COMPANY_ID }, select: { id: true } }).then((rows) => rows.map((r) => r.id)) } } });
  await db.shipment.deleteMany({ where: { order: { companyId: TEST_COMPANY_ID } } });
  await db.orderTimelineEvent.deleteMany({ where: { order: { companyId: TEST_COMPANY_ID } } });
  await db.orderItem.deleteMany({ where: { order: { companyId: TEST_COMPANY_ID } } });
  await db.order.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { companyId: TEST_COMPANY_ID } } });
  await db.purchaseOrder.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.product.delete({ where: { id: TEST_PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('createFromPurchaseOrder', () => {
  it('rejects an invalid card and creates no order at all', async () => {
    const po = await createScratchPurchaseOrder();
    const result = await createFromPurchaseOrder(po, 'CARD', { cardNumber: '1234', cvv: '12' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYMENT_FAILED');

    const refetched = await db.purchaseOrder.findUnique({ where: { id: po.id } });
    expect(refetched?.orderId).toBeNull();
  });

  it('charges a real payment, derives paymentStatus from method - PAID for everything except CREDIT_TERMS', async () => {
    const po = await createScratchPurchaseOrder();
    const result = await createFromPurchaseOrder(po, 'CARD', VALID_CARD);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('CONFIRMED');
      expect(result.data.paymentStatus).toBe('PAID');
      expect(result.data.purchaseOrderId).toBe(po.id);
    }

    const timeline = await listTimeline(result.ok ? result.data.id : '');
    expect(timeline.ok).toBe(true);
    if (timeline.ok) expect(timeline.data.some((e) => e.status === 'PAYMENT_CONFIRMED')).toBe(true);

    const shipments = await listShipments(result.ok ? result.data.id : '');
    expect(shipments.ok).toBe(true);
    if (shipments.ok) {
      expect(shipments.data).toHaveLength(1);
      expect(shipments.data[0].status).toBe('PREPARING');
    }

    // A real Payment row (linked to the invoice it produced) and a real Invoice row now exist -
    // not just an Order, closing the boundary the mock left as two separate client-side calls.
    const payment = await db.payment.findFirst({ where: { orderId: result.ok ? result.data.id : undefined } });
    expect(payment?.status).toBe('PAID');
    expect(payment?.invoiceId).toBeDefined();

    const invoice = await db.invoice.findUnique({ where: { id: payment!.invoiceId! } });
    expect(invoice?.status).toBe('PAID');
    expect(Number(invoice?.total)).toBe(po.total);
  });

  it('leaves paymentStatus PENDING for CREDIT_TERMS (invoice stays due), and never converts the same PO twice', async () => {
    const po = await createScratchPurchaseOrder();
    const first = await createFromPurchaseOrder(po, 'CREDIT_TERMS', {});
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.paymentStatus).toBe('PENDING');

    const invoice = await db.invoice.findFirst({ where: { orderId: first.ok ? first.data.id : undefined } });
    expect(invoice?.status).toBe('PENDING');
    expect(Number(invoice?.amountPaid)).toBe(0);

    // po.orderId is still the pre-conversion snapshot (undefined) - the real guard is checked
    // against the just-updated database row, not this stale DTO.
    const refetched = await db.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: true, supplier: true } });
    expect(refetched?.orderId).toBeDefined();
    const alreadyConvertedPo = toPurchaseOrderDto(refetched!);
    const second = await createFromPurchaseOrder(alreadyConvertedPo, 'CARD', VALID_CARD);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('ALREADY_CONVERTED');
  });
});

describe('fulfillment state machine', () => {
  it('walks CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED, refusing out-of-order transitions', async () => {
    const po = await createScratchPurchaseOrder();
    const created = await createFromPurchaseOrder(po, 'CARD', VALID_CARD);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const orderId = created.data.id;

    const dispatchTooSoon = await dispatchOrder(orderId, 'Test Driver');
    expect(dispatchTooSoon.ok).toBe(false);
    if (!dispatchTooSoon.ok) expect(dispatchTooSoon.error.code).toBe('INVALID_STATE');

    const processing = await markProcessing(orderId);
    expect(processing.ok).toBe(true);
    if (processing.ok) expect(processing.data.status).toBe('PROCESSING');

    const dispatched = await dispatchOrder(orderId, 'Test Driver');
    expect(dispatched.ok).toBe(true);
    if (dispatched.ok) expect(dispatched.data.status).toBe('SHIPPED');
    const shipmentsAfterDispatch = await listShipments(orderId);
    if (shipmentsAfterDispatch.ok) {
      expect(shipmentsAfterDispatch.data[0].status).toBe('IN_TRANSIT');
      expect(shipmentsAfterDispatch.data[0].driverName).toBe('Test Driver');
    }

    const delivered = await markDelivered(orderId);
    expect(delivered.ok).toBe(true);
    if (delivered.ok) expect(delivered.data.status).toBe('DELIVERED');

    const deliveries = await listDeliveries(orderId);
    expect(deliveries.ok).toBe(true);
    if (deliveries.ok) {
      expect(deliveries.data).toHaveLength(1);
      expect(deliveries.data[0].deliveredQty).toBe(1);
    }

    const timeline = await listTimeline(orderId);
    expect(timeline.ok).toBe(true);
    if (timeline.ok) expect(timeline.data.map((e) => e.status)).toEqual(['PENDING', 'PAYMENT_CONFIRMED', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']);
  });
});

describe('markRefunded', () => {
  it("sets paymentStatus to REFUNDED without touching the order's fulfillment status", async () => {
    const po = await createScratchPurchaseOrder();
    const created = await createFromPurchaseOrder(po, 'CARD', VALID_CARD);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const refunded = await markRefunded(created.data.id);
    expect(refunded.ok).toBe(true);
    if (refunded.ok) {
      expect(refunded.data.paymentStatus).toBe('REFUNDED');
      expect(refunded.data.status).toBe('CONFIRMED');
    }

    const reread = await getOrder(created.data.id);
    expect(reread.ok).toBe(true);
    if (reread.ok) expect(reread.data.paymentStatus).toBe('REFUNDED');
  });

  it('returns NOT_FOUND for an order that does not exist', async () => {
    const result = await markRefunded('order-does-not-exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});
