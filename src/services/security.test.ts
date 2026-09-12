import { beforeEach, describe, expect, it } from 'vitest';
import { ownsRecord } from './base';
import { ordersService } from './orders.service';
import { procurementService } from './procurement.service';
import { purchaseOrderService } from './purchase-order.service';
import { invoicesService } from './invoices.service';
import { catalogService } from './catalog.service';
import { disputesService } from './disputes.service';
import { Role } from '@/config/rbac';

/**
 * Phase 9 security regression suite (section 9.3's test matrix). Every case here corresponds to
 * a real gap found and fixed during the Phase 9 audit - a `get<Entity>ById` or entity-scoped
 * mutation that used to trust an attacker-controlled id without checking the caller actually
 * owns the record. These must keep failing closed (NOT_FOUND, never a distinct "forbidden" that
 * would confirm the record exists) as the app grows.
 */

const OTHER_COMPANY = { companyId: 'company-not-mine' };
const OTHER_SUPPLIER = { supplierId: 'supplier-not-mine' };
const PLATFORM_ADMIN = { isPlatformAdmin: true };

// Real seed ids this suite probes against - see lib/demo-data/*.ts.
const REAL_ORDER_ID = 'order-10082'; // company-acme-gh / supplier-abc
const REAL_RFQ_ID = 'rfq-10082'; // company-acme-gh, supplier-abc + supplier-wae invited
const REAL_PR_ID = 'pr-10082'; // company-acme-gh
const REAL_PO_ID = 'po-2026-00182'; // company-acme-gh / supplier-abc
const REAL_INVOICE_ID = 'invoice-10282'; // company-acme-gh / supplier-abc
const REAL_PRODUCT_ID = 'prod-cisco-switch'; // supplier-abc

beforeEach(() => {
  window.localStorage.clear();
});

describe('ownsRecord (the shared tenant-ownership check)', () => {
  it('grants a platform admin access to anything', () => {
    expect(ownsRecord(PLATFORM_ADMIN, 'any-company', 'any-supplier')).toBe(true);
    expect(ownsRecord(PLATFORM_ADMIN)).toBe(true);
  });

  it('grants a buyer access only to their own company id', () => {
    expect(ownsRecord({ companyId: 'company-acme-gh' }, 'company-acme-gh')).toBe(true);
    expect(ownsRecord({ companyId: 'company-acme-gh' }, 'company-other')).toBe(false);
  });

  it('grants a supplier access only to their own supplier id', () => {
    expect(ownsRecord({ supplierId: 'supplier-abc' }, undefined, 'supplier-abc')).toBe(true);
    expect(ownsRecord({ supplierId: 'supplier-abc' }, undefined, 'supplier-other')).toBe(false);
  });

  it('denies an empty tenant context (no session) by default', () => {
    expect(ownsRecord({}, 'company-acme-gh', 'supplier-abc')).toBe(false);
  });
});

describe('IDOR: order detail (buyer accessing another company; supplier accessing another supplier)', () => {
  it("refuses a buyer from a different company reading someone else's order", async () => {
    const result = await ordersService.getOrder(REAL_ORDER_ID, OTHER_COMPANY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it("refuses a supplier who isn't fulfilling this order", async () => {
    const result = await ordersService.getOrder(REAL_ORDER_ID, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
  });

  it('allows the owning buyer company', async () => {
    const result = await ordersService.getOrder(REAL_ORDER_ID, { companyId: 'company-acme-gh' });
    expect(result.ok).toBe(true);
  });

  it('allows the fulfilling supplier', async () => {
    const result = await ordersService.getOrder(REAL_ORDER_ID, { supplierId: 'supplier-abc' });
    expect(result.ok).toBe(true);
  });

  it('allows a platform admin regardless of tenant', async () => {
    const result = await ordersService.getOrder(REAL_ORDER_ID, PLATFORM_ADMIN);
    expect(result.ok).toBe(true);
  });
});

describe('IDOR: order fulfillment mutations (a supplier fulfilling an order that is not theirs)', () => {
  it('refuses markProcessing for a supplier who does not own the order', async () => {
    const result = await ordersService.markProcessing(REAL_ORDER_ID, Role.SUPPLIER_ADMIN, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('refuses dispatchOrder for a supplier who does not own the order', async () => {
    const result = await ordersService.dispatchOrder(REAL_ORDER_ID, 'Some Driver', Role.SUPPLIER_ADMIN, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
  });

  it('refuses markDelivered for a supplier who does not own the order', async () => {
    const result = await ordersService.markDelivered(REAL_ORDER_ID, Role.SUPPLIER_ADMIN, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
  });
});

describe('IDOR: RFQ detail (buyer from another company; an uninvited supplier)', () => {
  it('refuses a different company reading this RFQ', async () => {
    const result = await procurementService.getRfq(REAL_RFQ_ID, OTHER_COMPANY);
    expect(result.ok).toBe(false);
  });

  it('refuses a supplier who was never invited to this RFQ', async () => {
    const result = await procurementService.getRfq(REAL_RFQ_ID, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
  });

  it('allows an invited supplier (supplier-abc was invited to rfq-10082)', async () => {
    const result = await procurementService.getRfq(REAL_RFQ_ID, { supplierId: 'supplier-abc' });
    expect(result.ok).toBe(true);
  });

  it('allows the owning buyer company', async () => {
    const result = await procurementService.getRfq(REAL_RFQ_ID, { companyId: 'company-acme-gh' });
    expect(result.ok).toBe(true);
  });
});

describe('Privilege escalation: purchase request approval across tenants', () => {
  it("refuses reading another company's purchase request", async () => {
    const result = await procurementService.getPurchaseRequest(REAL_PR_ID, OTHER_COMPANY);
    expect(result.ok).toBe(false);
  });

  it("a Finance Manager at a different company cannot approve/reject someone else's purchase request, even with the matching approver role", async () => {
    const result = await procurementService.decideStep(REAL_PR_ID, Role.FINANCE_MANAGER, 'APPROVED', OTHER_COMPANY, 'looks fine to me');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('IDOR: purchase order detail (buyer vs. supplier vs. an unrelated tenant)', () => {
  it('refuses an unrelated company', async () => {
    const result = await purchaseOrderService.getPurchaseOrder(REAL_PO_ID, OTHER_COMPANY);
    expect(result.ok).toBe(false);
  });

  it('refuses an unrelated supplier', async () => {
    const result = await purchaseOrderService.getPurchaseOrder(REAL_PO_ID, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
  });

  it('allows the buying company and the fulfilling supplier', async () => {
    expect((await purchaseOrderService.getPurchaseOrder(REAL_PO_ID, { companyId: 'company-acme-gh' })).ok).toBe(true);
    expect((await purchaseOrderService.getPurchaseOrder(REAL_PO_ID, { supplierId: 'supplier-abc' })).ok).toBe(true);
  });
});

describe('Financial integrity: unauthorized invoice access and payment', () => {
  it("refuses reading another company's invoice", async () => {
    const result = await invoicesService.getInvoice(REAL_INVOICE_ID, OTHER_COMPANY);
    expect(result.ok).toBe(false);
  });

  it("refuses paying another company's invoice even with a valid PAYMENTS_CREATE role", async () => {
    const result = await invoicesService.payInvoice(REAL_INVOICE_ID, 'WALLET', {}, Role.OWNER, OTHER_COMPANY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe("Supplier modifying another supplier's product", () => {
  it('refuses updating a product owned by a different supplier', async () => {
    const result = await catalogService.updateProduct(REAL_PRODUCT_ID, { basePrice: 1 }, Role.SUPPLIER_ADMIN, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('refuses adjusting inventory for a product owned by a different supplier', async () => {
    const result = await catalogService.updateInventory(REAL_PRODUCT_ID, 'wh-abc-accra', { stock: 0 }, Role.SUPPLIER_ADMIN, OTHER_SUPPLIER);
    expect(result.ok).toBe(false);
  });

  it('refuses creating a product attributed to a different supplier id than the caller', async () => {
    const result = await catalogService.createProduct(
      {
        name: 'Impersonated listing',
        brand: 'x',
        sku: 'x',
        supplierId: 'supplier-abc',
        categoryId: 'cat-networking',
        description: 'x',
        currency: 'GHS',
        basePrice: 100,
        moq: 1,
        warehouseId: 'wh-abc-accra',
        stock: 1,
        lowStockThreshold: 1,
      },
      Role.SUPPLIER_ADMIN,
      OTHER_SUPPLIER,
    );
    expect(result.ok).toBe(false);
  });

  it('allows the owning supplier to update their own product', async () => {
    const result = await catalogService.updateProduct(REAL_PRODUCT_ID, { basePrice: 8500 }, Role.SUPPLIER_ADMIN, { supplierId: 'supplier-abc' });
    expect(result.ok).toBe(true);
  });
});

describe('Employee attempting an approval action (role, not just tenant)', () => {
  it('an EMPLOYEE role lacks PURCHASE_REQUEST_APPROVE and is refused before any tenant check runs', async () => {
    const result = await procurementService.decideStep(REAL_PR_ID, Role.EMPLOYEE, 'APPROVED', { companyId: 'company-acme-gh' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('Fabricated dispute: filing a dispute against an order that is not the caller\'s', () => {
  it('refuses creating a dispute for an order belonging to another company', async () => {
    const result = await disputesService.createDispute(
      { orderId: REAL_ORDER_ID, reason: 'not mine', description: 'attempting to dispute an order I do not own' },
      OTHER_COMPANY,
    );
    expect(result.ok).toBe(false);
  });

  it('derives orderReference/companyId/supplierId from the real order, never from client input', async () => {
    const result = await disputesService.createDispute(
      { orderId: REAL_ORDER_ID, reason: 'genuine issue', description: 'item arrived late' },
      { companyId: 'company-acme-gh' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.companyId).toBe('company-acme-gh');
      expect(result.data.supplierId).toBe('supplier-abc');
    }
  });
});
