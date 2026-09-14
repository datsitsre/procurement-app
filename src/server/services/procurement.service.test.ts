// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { getEffectiveSpendingLimit, setSpendingLimit } from './company.service';
import {
  acceptQuote,
  createApprovalRule,
  createPurchaseRequest,
  createRfq,
  decideStep,
  getPurchaseRequest,
  getRfq,
  listApprovalRules,
  listNegotiationMessages,
  listPendingApprovals,
  listPurchaseRequests,
  listQuotesForRfq,
  listRfqs,
  listRfqsForSupplier,
  removeApprovalRule,
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
  // Purchase-request/approval-rule tests (Stage 6) need this user to actually be a member of the
  // scratch company - createPurchaseRequest looks up the membership to resolve the requester's
  // role for spending-limit enforcement.
  await db.companyMembership.create({
    data: { companyId: TEST_COMPANY_ID, userId: TEST_USER_ID, role: 'EMPLOYEE', status: 'ACTIVE', joinedAt: new Date() },
  });
});

afterAll(async () => {
  await db.negotiationMessage.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.quoteItem.deleteMany({ where: { quote: { rfq: { companyId: TEST_COMPANY_ID } } } });
  await db.quote.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.rFQSupplier.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.rFQItem.deleteMany({ where: { rfq: { companyId: TEST_COMPANY_ID } } });
  await db.rFQ.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.approvalStep.deleteMany({ where: { request: { companyId: TEST_COMPANY_ID } } });
  await db.purchaseRequestItem.deleteMany({ where: { request: { companyId: TEST_COMPANY_ID } } });
  await db.purchaseRequest.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.approvalRule.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.spendingLimit.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
  await db.companyMembership.deleteMany({ where: { companyId: TEST_COMPANY_ID } });
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

describe('approval rules (Phase 14, Stage 6)', () => {
  it('rejects a rule whose max is not greater than its min', async () => {
    const result = await createApprovalRule({ companyId: TEST_COMPANY_ID, minAmount: 10000, maxAmount: 5000, requiredApproverRoles: ['OWNER'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_RANGE');
  });

  it('rejects a rule with no approver roles', async () => {
    const result = await createApprovalRule({ companyId: TEST_COMPANY_ID, minAmount: 200000, requiredApproverRoles: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it('rejects naming a role that cannot approve purchase requests (would strand the request)', async () => {
    const result = await createApprovalRule({ companyId: TEST_COMPANY_ID, minAmount: 200000, requiredApproverRoles: ['EMPLOYEE'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ROLE_CANNOT_APPROVE');
  });

  it('creates a rule, lists it, then rejects an overlapping range, then removes it', async () => {
    const created = await createApprovalRule({ companyId: TEST_COMPANY_ID, minAmount: 200000, requiredApproverRoles: ['OWNER'] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const list = await listApprovalRules(TEST_COMPANY_ID);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.some((r) => r.id === created.data.id)).toBe(true);

    const overlap = await createApprovalRule({ companyId: TEST_COMPANY_ID, minAmount: 150000, maxAmount: 250000, requiredApproverRoles: ['OWNER'] });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.error.code).toBe('OVERLAPPING_RANGE');

    // Removing scoped to a different company (the real ownership check the route also performs
    // via requireCompanyAccess) finds nothing - only the rule's own company can remove it.
    const wrongCompany = await removeApprovalRule('company-not-mine', created.data.id);
    expect(wrongCompany.ok).toBe(false);
    if (!wrongCompany.ok) expect(wrongCompany.error.code).toBe('NOT_FOUND');

    const removed = await removeApprovalRule(TEST_COMPANY_ID, created.data.id);
    expect(removed.ok).toBe(true);
  });
});

describe('purchase requests + spending limits + approvals (Phase 14, Stage 6)', () => {
  it('rejects a purchase request with no items', async () => {
    const result = await createPurchaseRequest({
      companyId: TEST_COMPANY_ID,
      requesterUserId: TEST_USER_ID,
      items: [],
      reason: 'Empty test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });

  it("rejects a purchase request over the requester's role spending limit, honors a company override, and lets a fresh purchase request through once the override is raised", async () => {
    const item = { productId: TEST_PRODUCT_ID, productName: 'Procurement Test Widget', supplierId: TEST_SUPPLIER_ID, supplierName: 'Procurement Test Supplier', quantity: 1, unitPrice: 100 };

    // The seeded default EMPLOYEE limit (config/spending-limits.ts) comfortably covers this.
    const underLimit = await createPurchaseRequest({ companyId: TEST_COMPANY_ID, requesterUserId: TEST_USER_ID, items: [item], reason: 'Under the default limit' });
    expect(underLimit.ok).toBe(true);

    // Lower the company's own override well below this request's total.
    const setResult = await setSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE', 5);
    expect(setResult.ok).toBe(true);
    expect(await getEffectiveSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE')).toBe(5);

    const overLimit = await createPurchaseRequest({ companyId: TEST_COMPANY_ID, requesterUserId: TEST_USER_ID, items: [item], reason: 'Now over the lowered limit' });
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.error.code).toBe('SPENDING_LIMIT_EXCEEDED');

    // Raise the override back up and confirm the same request now goes through.
    await setSpendingLimit(TEST_COMPANY_ID, 'EMPLOYEE', 100000);
    const nowUnderLimit = await createPurchaseRequest({ companyId: TEST_COMPANY_ID, requesterUserId: TEST_USER_ID, items: [item], reason: 'Under the raised override' });
    expect(nowUnderLimit.ok).toBe(true);
  });

  it('resolves approval steps from the fallback OWNER band when the company has no approval rules, decides it, and rejects a comment-less rejection', async () => {
    const pr = await createPurchaseRequest({
      companyId: TEST_COMPANY_ID,
      requesterUserId: TEST_USER_ID,
      items: [{ productId: TEST_PRODUCT_ID, productName: 'Procurement Test Widget', supplierId: TEST_SUPPLIER_ID, supplierName: 'Procurement Test Supplier', quantity: 1, unitPrice: 100 }],
      reason: 'Approval flow test',
    });
    expect(pr.ok).toBe(true);
    if (!pr.ok) return;
    expect(pr.data.approvalSteps).toHaveLength(1);
    expect(pr.data.approvalSteps[0].approverRole).toBe('OWNER');
    expect(pr.data.status).toBe('IN_APPROVAL');

    const wrongApprover = await decideStep(pr.data.id, 'FINANCE_MANAGER', 'APPROVED', TEST_USER_ID);
    expect(wrongApprover.ok).toBe(false);
    if (!wrongApprover.ok) expect(wrongApprover.error.code).toBe('WRONG_APPROVER');

    const noReason = await decideStep(pr.data.id, 'OWNER', 'REJECTED', TEST_USER_ID);
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error.code).toBe('REASON_REQUIRED');

    const pending = await listPendingApprovals(TEST_COMPANY_ID, 'OWNER');
    expect(pending.ok).toBe(true);
    if (pending.ok) expect(pending.data.some((p) => p.id === pr.data.id)).toBe(true);

    const decided = await decideStep(pr.data.id, 'OWNER', 'APPROVED', TEST_USER_ID);
    expect(decided.ok).toBe(true);
    if (decided.ok) {
      expect(decided.data.status).toBe('CONVERTED_TO_PO');
      expect(decided.data.approvalSteps[0].status).toBe('APPROVED');
      expect(decided.data.approvalSteps[0].approverName).toBe('John Doe');
    }

    const fetched = await getPurchaseRequest(pr.data.id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.data.status).toBe('CONVERTED_TO_PO');

    const list = await listPurchaseRequests(TEST_COMPANY_ID);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.some((p) => p.id === pr.data.id)).toBe(true);
  });
});
