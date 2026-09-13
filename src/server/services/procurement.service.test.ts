// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  acceptQuote,
  createRfq,
  getRfq,
  listNegotiationMessages,
  listQuotesForRfq,
  listRfqs,
  listRfqsForSupplier,
  sendNegotiationMessage,
  submitQuote,
} from './procurement.service';

/**
 * Phase 14, Stage 5 - real, database-backed regression suite for RFQs/quotes/negotiation. Runs
 * against the actual dev Postgres database, scoped to a dedicated test company/supplier/category/
 * product this suite creates and cleans up in `afterAll` - never touches seeded demo data.
 */

const TEST_COMPANY_ID = `test-company-procurement-${Date.now()}`;
const TEST_SUPPLIER_ID = `test-supplier-procurement-${Date.now()}`;
const TEST_CATEGORY_ID = `test-category-procurement-${Date.now()}`;
const TEST_PRODUCT_ID = `test-product-procurement-${Date.now()}`;
const TEST_USER_ID = 'user-john-doe'; // seeded buyer at company-acme-gh, reused here as the RFQ creator

beforeAll(async () => {
  await db.company.create({
    data: { id: TEST_COMPANY_ID, name: 'Procurement Test Buyer Co', country: 'GH', currency: 'GHS' },
  });
  await db.company.create({
    data: { id: `${TEST_SUPPLIER_ID}-company`, name: 'Procurement Test Supplier Co', country: 'GH', currency: 'GHS', isSupplier: true },
  });
  await db.supplierProfile.create({
    data: {
      id: TEST_SUPPLIER_ID,
      companyId: `${TEST_SUPPLIER_ID}-company`,
      name: 'Procurement Test Supplier',
      slug: `procurement-test-supplier-${Date.now()}`,
      city: 'Accra',
      country: 'Ghana',
      description: '',
      verification: 'VERIFIED',
    },
  });
  await db.category.create({ data: { id: TEST_CATEGORY_ID, name: 'Procurement Test Category', slug: `procurement-test-category-${Date.now()}` } });
  await db.product.create({
    data: {
      id: TEST_PRODUCT_ID,
      supplierId: TEST_SUPPLIER_ID,
      categoryId: TEST_CATEGORY_ID,
      name: 'Procurement Test Widget',
      slug: `procurement-test-widget-${Date.now()}`,
      brand: 'x',
      sku: 'x',
      description: 'x',
      currency: 'GHS',
      basePrice: 100,
      moq: 1,
      moderationStatus: 'PUBLISHED',
    },
  });
});

afterAll(async () => {
  await db.negotiationMessage.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.quoteItem.deleteMany({ where: { quote: { rfq: { companyId: TEST_COMPANY_ID } } } });
  await db.quote.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.rFQSupplier.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.rFQItem.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.rFQ.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.product.delete({ where: { id: TEST_PRODUCT_ID } }).catch(() => undefined);
  await db.category.delete({ where: { id: TEST_CATEGORY_ID } }).catch(() => undefined);
  await db.supplierProfile.delete({ where: { id: TEST_SUPPLIER_ID } }).catch(() => undefined);
  await db.company.delete({ where: { id: `${TEST_SUPPLIER_ID}-company` } }).catch(() => undefined);
  await db.company.delete({ where: { id: TEST_COMPANY_ID } }).catch(() => undefined);
});

describe('createRfq', () => {
  it('rejects an RFQ with no items', async () => {
    const result = await createRfq({
      companyId: TEST_COMPANY_ID,
      createdByUserId: TEST_USER_ID,
      items: [],
      requiredDeliveryDate: new Date().toISOString(),
      deliveryLocation: 'Accra',
      supplierIds: [TEST_SUPPLIER_ID],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it('rejects an RFQ with no invited suppliers', async () => {
    const result = await createRfq({
      companyId: TEST_COMPANY_ID,
      createdByUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Procurement Test Widget', quantity: 5 }],
      requiredDeliveryDate: new Date().toISOString(),
      deliveryLocation: 'Accra',
      supplierIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_SUPPLIERS');
  });

  it('creates an RFQ, invites the supplier as SENT/INVITED, and lists it both ways', async () => {
    const created = await createRfq({
      companyId: TEST_COMPANY_ID,
      createdByUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Procurement Test Widget', quantity: 5 }],
      requiredDeliveryDate: new Date().toISOString(),
      deliveryLocation: 'Accra',
      supplierIds: [TEST_SUPPLIER_ID],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.status).toBe('SENT');
    expect(created.data.suppliers).toEqual([{ supplierId: TEST_SUPPLIER_ID, supplierName: 'Procurement Test Supplier', status: 'INVITED' }]);

    const buyerList = await listRfqs(TEST_COMPANY_ID);
    expect(buyerList.ok).toBe(true);
    if (buyerList.ok) expect(buyerList.data.some((r) => r.id === created.data.id)).toBe(true);

    const supplierList = await listRfqsForSupplier(TEST_SUPPLIER_ID);
    expect(supplierList.ok).toBe(true);
    if (supplierList.ok) expect(supplierList.data.some((r) => r.id === created.data.id)).toBe(true);
  });
});

describe('submitQuote', () => {
  it("refuses a quote from a supplier that wasn't invited", async () => {
    const rfq = await createRfq({
      companyId: TEST_COMPANY_ID,
      createdByUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Procurement Test Widget', quantity: 5 }],
      requiredDeliveryDate: new Date().toISOString(),
      deliveryLocation: 'Accra',
      supplierIds: [TEST_SUPPLIER_ID],
    });
    expect(rfq.ok).toBe(true);
    if (!rfq.ok) return;

    const result = await submitQuote({
      rfqId: rfq.data.id,
      supplierId: 'supplier-not-invited',
      items: [{ productId: TEST_PRODUCT_ID, quantity: 5, unitPrice: 100 }],
      deliveryDays: 3,
      warrantyMonths: 12,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_INVITED');
  });

  it('accepts an invited supplier\'s quote, moves the RFQ to QUOTED, and refuses a second quote from the same supplier', async () => {
    const rfq = await createRfq({
      companyId: TEST_COMPANY_ID,
      createdByUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Procurement Test Widget', quantity: 5 }],
      requiredDeliveryDate: new Date().toISOString(),
      deliveryLocation: 'Accra',
      supplierIds: [TEST_SUPPLIER_ID],
    });
    expect(rfq.ok).toBe(true);
    if (!rfq.ok) return;

    const quote = await submitQuote({
      rfqId: rfq.data.id,
      supplierId: TEST_SUPPLIER_ID,
      items: [{ productId: TEST_PRODUCT_ID, quantity: 5, unitPrice: 90 }],
      deliveryDays: 3,
      warrantyMonths: 12,
    });
    expect(quote.ok).toBe(true);
    if (quote.ok) expect(quote.data.totalPrice).toBe(450);

    const updatedRfq = await getRfq(rfq.data.id);
    expect(updatedRfq.ok).toBe(true);
    if (updatedRfq.ok) {
      expect(updatedRfq.data.status).toBe('QUOTED');
      expect(updatedRfq.data.suppliers[0].status).toBe('QUOTED');
    }

    const dupe = await submitQuote({
      rfqId: rfq.data.id,
      supplierId: TEST_SUPPLIER_ID,
      items: [{ productId: TEST_PRODUCT_ID, quantity: 5, unitPrice: 80 }],
      deliveryDays: 3,
      warrantyMonths: 12,
    });
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) expect(dupe.error.code).toBe('ALREADY_QUOTED');

    const forRfq = await listQuotesForRfq(rfq.data.id);
    expect(forRfq.ok).toBe(true);
    if (forRfq.ok) expect(forRfq.data).toHaveLength(1);
  });
});

describe('negotiation and acceptance', () => {
  it('records a buyer message plus a canned supplier reply, then accepts the quote', async () => {
    const rfq = await createRfq({
      companyId: TEST_COMPANY_ID,
      createdByUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Procurement Test Widget', quantity: 10 }],
      requiredDeliveryDate: new Date().toISOString(),
      deliveryLocation: 'Accra',
      supplierIds: [TEST_SUPPLIER_ID],
    });
    expect(rfq.ok).toBe(true);
    if (!rfq.ok) return;

    const quote = await submitQuote({
      rfqId: rfq.data.id,
      supplierId: TEST_SUPPLIER_ID,
      items: [{ productId: TEST_PRODUCT_ID, quantity: 10, unitPrice: 95 }],
      deliveryDays: 2,
      warrantyMonths: 24,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;

    const sent = await sendNegotiationMessage(rfq.data.id, quote.data.id, 'Can you do 90 per unit?', TEST_USER_ID, 90, 10);
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.data).toHaveLength(2);
      expect(sent.data[0].senderRole).toBe('BUYER');
      expect(sent.data[1].senderRole).toBe('SUPPLIER');
    }

    const thread = await listNegotiationMessages(rfq.data.id, quote.data.id);
    expect(thread.ok).toBe(true);
    if (thread.ok) expect(thread.data).toHaveLength(2);

    const accepted = await acceptQuote(rfq.data.id, quote.data.id);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.data.rfq.status).toBe('ACCEPTED');
      expect(accepted.data.rfq.acceptedQuoteId).toBe(quote.data.id);
    }
  });
});
