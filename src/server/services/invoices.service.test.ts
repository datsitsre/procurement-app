// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { toOrderDto } from '@/server/dto/orders';
import { createForOrder, dueDaysFor, getInvoice, payInvoice } from './invoices.service';

/**
 * Phase 14, Stage 8 - real, database-backed regression suite for invoices: raising an invoice
 * for a checked-out order, and paying it down. Runs against the actual dev Postgres database,
 * scoped to a dedicated test company/supplier/category/product this suite creates and cleans up
 * in `afterAll` - never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-invoices-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-invoices-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-invoices-${Date.now()}`;
const TEST_PRODUCT_ID = `test-product-invoices-${Date.now()}`;

async function createScratchOrder(paymentStatus: 'PAID' | 'PENDING') {
  const order = await db.order.create({
    data: {
      reference: `ORD-TEST-${Date.now()}-${Math.random()}`,
      companyId: TEST_COMPANY_ID,
      supplierId: TEST_SUPPLIER_ID,
      subtotal: 1000,
      tax: 125,
      deliveryFee: 2000,
      total: 3125,
      status: 'CONFIRMED',
      paymentStatus,
      deliveryLocation: 'Accra',
      items: { create: [{ productId: TEST_PRODUCT_ID, productName: 'Invoices Test Widget', quantity: 1, unitPrice: 1000 }] },
    },
    include: { items: true, supplier: true },
  });
  return toOrderDto(order);
}

beforeAll(async () => {
  await db.company.create({ data: { id: TEST_COMPANY_ID, name: 'Invoices Test Buyer Co', country: 'GH', currency: 'GHS', creditTerms: 'NET_15' } });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Invoices Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Invoices Test Supplier',
      slug: `invoices-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Invoices Test Category', slug: `invoices-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: TEST_PRODUCT_ID,
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Invoices Test Widget',
      slug: `invoices-test-widget-${Date.now()}`,
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
  await db.orderItem.deleteMany({ where: { order: { companyId: TEST_COMPANY_ID } } });
  await db.order.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.product.delete({ where: { id: TEST_PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('dueDaysFor', () => {
  it('maps every credit term to the right number of days', () => {
    expect(dueDaysFor('PREPAID')).toBe(0);
    expect(dueDaysFor('NET_7')).toBe(7);
    expect(dueDaysFor('NET_15')).toBe(15);
    expect(dueDaysFor('NET_30')).toBe(30);
    expect(dueDaysFor('NET_60')).toBe(60);
  });
});

describe('createForOrder', () => {
  it('is PAID up front with amountPaid == total for an already-paid order', async () => {
    const order = await createScratchOrder('PAID');
    const invoice = await createForOrder(order);
    expect(invoice.status).toBe('PAID');
    expect(invoice.amountPaid).toBe(order.total);
    expect(invoice.total).toBe(order.total);
  });

  it("is PENDING, due dueDaysFor(company's credit term) out, for an order still owed", async () => {
    const order = await createScratchOrder('PENDING');
    const invoice = await createForOrder(order);
    expect(invoice.status).toBe('PENDING');
    expect(invoice.amountPaid).toBe(0);

    const expectedDueDate = new Date(new Date(invoice.issuedAt).getTime() + 15 * 24 * 60 * 60 * 1000);
    expect(new Date(invoice.dueDate).toDateString()).toBe(expectedDueDate.toDateString());
  });
});

describe('payInvoice', () => {
  it('rejects paying an invoice that is already paid in full', async () => {
    const order = await createScratchOrder('PAID');
    const invoice = await createForOrder(order);

    const result = await payInvoice(invoice.id, 'WALLET', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ALREADY_PAID');
  });

  it('pays down the remaining amount due, never a client-supplied amount', async () => {
    const order = await createScratchOrder('PENDING');
    const invoice = await createForOrder(order);
    expect(invoice.amountPaid).toBe(0);

    const result = await payInvoice(invoice.id, 'WALLET', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('PAID');
      expect(result.data.amountPaid).toBe(invoice.total);
    }

    const reread = await getInvoice(invoice.id);
    expect(reread.ok).toBe(true);
    if (reread.ok) expect(reread.data.status).toBe('PAID');
  });

  it('rejects an invalid card and leaves the invoice unpaid', async () => {
    const order = await createScratchOrder('PENDING');
    const invoice = await createForOrder(order);

    const result = await payInvoice(invoice.id, 'CARD', { cardNumber: '1234', cvv: '12' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYMENT_FAILED');

    const reread = await getInvoice(invoice.id);
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.data.status).toBe('PENDING');
      expect(reread.data.amountPaid).toBe(0);
    }
  });

  it('refuses to start a second charge while a payment for this invoice is already PENDING - a real mobile money charge is asynchronous, so a re-submitted pay form must not double-charge', async () => {
    const order = await createScratchOrder('PENDING');
    const invoice = await createForOrder(order);

    await db.payment.create({
      data: { companyId: TEST_COMPANY_ID, invoiceId: invoice.id, amount: invoice.total, method: 'MTN_MOMO', status: 'PENDING', reference: `pay-pending-${Date.now()}` },
    });

    const result = await payInvoice(invoice.id, 'MTN_MOMO', { phone: '0244000000' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PAYMENT_PENDING');

    const reread = await getInvoice(invoice.id);
    expect(reread.ok).toBe(true);
    if (reread.ok) expect(reread.data.amountPaid).toBe(0);
  });
});
