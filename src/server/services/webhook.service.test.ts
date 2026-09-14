// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { processPaymentWebhook, verifyWebhookSignature } from './webhook.service';

/**
 * Phase 14, Stage 11 - real, database-backed regression suite for inbound payment webhooks:
 * signature verification and idempotent payment/invoice settlement. Runs against the actual dev
 * Postgres database, scoped to a dedicated test company/supplier/order/invoice/payment this
 * suite creates and cleans up in `afterAll` - never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-webhook-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-webhook-${Date.now()}`;

let pendingPaymentReference: string;
let pendingPaymentId: string;
let invoiceId: string;
let orderId: string;
let orderPaymentReference: string;
let orderPaymentId: string;

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Webhook Test Buyer Co', country: 'GH', currency: 'GHS' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Webhook Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Webhook Test Supplier',
      slug: `webhook-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });

  const invoice = await db.invoice.create({
    data: {
      reference: `INV-WEBHOOK-${Date.now()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      total: 1125,
      amountPaid: 0,
      status: 'PENDING',
      // Not-yet-due on purpose: this fixture only exercises webhook settlement, but an
      // already-past-due PENDING invoice is also in scope for runInvoiceDueSweep (see
      // jobs/invoiceDueSweep.ts) - a concurrently running test file's sweep could flip this
      // invoice to OVERDUE mid-test and fail an assertion that has nothing to do with that job.
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  invoiceId = invoice.id;

  pendingPaymentReference = `MTN-WEBHOOK-${Date.now()}`;
  const payment = await db.payment.create({
    data: {
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      invoiceId,
      amount: 1125,
      method: 'MTN_MOMO',
      status: 'PENDING',
      reference: pendingPaymentReference,
    },
  });
  pendingPaymentId = payment.id;

  const order = await db.order.create({
    data: {
      reference: `ORD-WEBHOOK-${Date.now()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      deliveryFee: 0,
      total: 1125,
      status: 'CONFIRMED',
      paymentStatus: 'PENDING',
      deliveryLocation: 'Accra',
    },
  });
  orderId = order.id;

  orderPaymentReference = `MTN-WEBHOOK-ORDER-${Date.now()}`;
  const orderPayment = await db.payment.create({
    data: {
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      orderId,
      amount: 1125,
      method: 'MTN_MOMO',
      status: 'PENDING',
      reference: orderPaymentReference,
    },
  });
  orderPaymentId = orderPayment.id;
});

afterEach(async () => {
  // Reset back to PENDING between tests in this file that mutate it, so each test starts from
  // the same known state without needing its own dedicated payment row.
  await db.paymentTransaction.deleteMany({ where: { paymentId: pendingPaymentId } });
  await db.payment.update({ where: { id: pendingPaymentId }, data: { status: 'PENDING' } });
  await db.invoice.update({ where: { id: invoiceId }, data: { status: 'PENDING', amountPaid: 0 } });
});

afterAll(async () => {
  await db.paymentTransaction.deleteMany({ where: { paymentId: { in: [pendingPaymentId, orderPaymentId] } } });
  await db.payment.deleteMany({ where: { id: { in: [pendingPaymentId, orderPaymentId] } } });
  await db.invoice.delete({ where: { id: invoiceId } }).catch(() => undefined);
  await db.orderTimelineEvent.deleteMany({ where: { orderId } });
  await db.order.delete({ where: { id: orderId } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

function sign(rawBody: string): string {
  return crypto.createHmac('sha256', env.PAYMENT_WEBHOOK_SIGNING_SECRET).update(rawBody).digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed body and rejects a tampered one', () => {
    const body = JSON.stringify({ providerReference: 'x', event: 'payment.captured' });
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
    expect(verifyWebhookSignature(body + ' ', sign(body))).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyWebhookSignature('{}', null)).toBe(false);
  });

  it('rejects a well-formed but wrong signature', () => {
    const body = JSON.stringify({ providerReference: 'x', event: 'payment.captured' });
    const wrongSignature = crypto.createHmac('sha256', 'not-the-real-secret').update(body).digest('hex');
    expect(verifyWebhookSignature(body, wrongSignature)).toBe(false);
  });
});

describe('processPaymentWebhook', () => {
  it('returns NOT_FOUND for a reference this app never created', async () => {
    const result = await processPaymentWebhook({ providerReference: 'does-not-exist', event: 'payment.captured' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('marks the payment PAID, settles the linked invoice, and records a WEBHOOK_RECEIVED transaction', async () => {
    const result = await processPaymentWebhook({ providerReference: pendingPaymentReference, event: 'payment.captured' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.changed).toBe(true);

    const payment = await db.payment.findUnique({ where: { id: pendingPaymentId } });
    expect(payment?.status).toBe('PAID');

    const transactions = await db.paymentTransaction.findMany({ where: { paymentId: pendingPaymentId } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].event).toBe('WEBHOOK_RECEIVED');

    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    expect(invoice?.status).toBe('PAID');
    expect(Number(invoice?.amountPaid)).toBe(1125);
  });

  it('is idempotent - replaying the same event is a no-op the second time', async () => {
    const first = await processPaymentWebhook({ providerReference: pendingPaymentReference, event: 'payment.captured' });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.changed).toBe(true);

    const second = await processPaymentWebhook({ providerReference: pendingPaymentReference, event: 'payment.captured' });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.changed).toBe(false);

    // Only one WEBHOOK_RECEIVED transaction exists, not two.
    const transactions = await db.paymentTransaction.findMany({ where: { paymentId: pendingPaymentId } });
    expect(transactions).toHaveLength(1);
  });

  it('marks the payment FAILED without touching the invoice', async () => {
    const result = await processPaymentWebhook({ providerReference: pendingPaymentReference, event: 'payment.failed' });
    expect(result.ok).toBe(true);

    const payment = await db.payment.findUnique({ where: { id: pendingPaymentId } });
    expect(payment?.status).toBe('FAILED');

    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    expect(invoice?.status).toBe('PENDING');
  });

  it("also settles a checkout payment's linked Order.paymentStatus - not just an invoice payment's linked invoice - and adds a PAYMENT_CONFIRMED timeline event", async () => {
    const result = await processPaymentWebhook({ providerReference: orderPaymentReference, event: 'payment.captured' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.changed).toBe(true);

    const order = await db.order.findUnique({ where: { id: orderId } });
    expect(order?.paymentStatus).toBe('PAID');

    const events = await db.orderTimelineEvent.findMany({ where: { orderId, status: 'PAYMENT_CONFIRMED' } });
    expect(events).toHaveLength(1);

    // Cleanup - this order's payment isn't reset by the shared afterEach (that only resets the
    // invoice-linked payment), so reset it here for the next test in this file.
    await db.paymentTransaction.deleteMany({ where: { paymentId: orderPaymentId } });
    await db.payment.update({ where: { id: orderPaymentId }, data: { status: 'PENDING' } });
    await db.order.update({ where: { id: orderId }, data: { paymentStatus: 'PENDING' } });
    await db.orderTimelineEvent.deleteMany({ where: { orderId, status: 'PAYMENT_CONFIRMED' } });
  });
});
