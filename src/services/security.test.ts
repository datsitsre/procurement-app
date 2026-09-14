import { beforeEach, describe, expect, it } from 'vitest';
import { ownsRecord } from './base';
import { ordersService } from './orders.service';
import { purchaseOrderService } from './purchase-order.service';
import { invoicesService } from './invoices.service';
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
const REAL_PO_ID = 'po-2026-00182'; // company-acme-gh / supplier-abc
const REAL_INVOICE_ID = 'invoice-10282'; // company-acme-gh / supplier-abc

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

// RFQ detail IDOR coverage moved to server/services/procurement.routes.test.ts (Phase 14, Stage
// 5) - procurementService.getRfq is now a real `/api/rfqs/[rfqId]` fetch() with no live server
// during `vitest run`, the same reason Stage 4 retired the equivalent product describe block.

// "Privilege escalation: purchase request approval across tenants" used to live here, testing
// procurementService's mock getPurchaseRequest/decideStep. That domain is now server-side (Phase
// 14, Stage 6) - the equivalent coverage (cross-tenant read refused, a Finance Manager at a
// different company refused despite the matching approver role) now lives in
// server/services/procurement.routes.test.ts, tested against the real database and actual route
// handlers instead of a client-side mock.

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

// "Supplier modifying another supplier's product" used to live here, testing catalogService's
// mock createProduct/updateProduct/updateInventory. That domain is now server-side (Phase 14,
// Stage 4) - the equivalent coverage (cross-supplier update/inventory/create all refused,
// owning supplier's own update allowed) now lives in server/services/catalog.service.test.ts
// and catalog.routes.test.ts, tested against the real database and the actual route handlers
// instead of a client-side mock.

// "Employee attempting an approval action (role, not just tenant)" moved alongside the block
// above, for the same reason - see server/services/procurement.routes.test.ts.

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
