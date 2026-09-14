import { beforeEach, describe, expect, it } from 'vitest';
import { ownsRecord } from './base';
import { invoicesService } from './invoices.service';
import { Role } from '@/config/rbac';

/**
 * Phase 9 security regression suite (section 9.3's test matrix). Every case here corresponds to
 * a real gap found and fixed during the Phase 9 audit - a `get<Entity>ById` or entity-scoped
 * mutation that used to trust an attacker-controlled id without checking the caller actually
 * owns the record. These must keep failing closed (NOT_FOUND, never a distinct "forbidden" that
 * would confirm the record exists) as the app grows.
 */

const OTHER_COMPANY = { companyId: 'company-not-mine' };
const PLATFORM_ADMIN = { isPlatformAdmin: true };

// Real seed ids this suite probes against - see lib/demo-data/*.ts.
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

// "IDOR: order detail" and "IDOR: order fulfillment mutations" used to live here, testing
// ordersService's mock getOrder/markProcessing/dispatchOrder/markDelivered. That domain is now
// server-side (Phase 14, Stage 7) - equivalent coverage now lives in
// server/services/orders.routes.test.ts, tested against the real database and actual route
// handlers instead of a client-side mock.

// RFQ detail IDOR coverage moved to server/services/procurement.routes.test.ts (Phase 14, Stage
// 5) - procurementService.getRfq is now a real `/api/rfqs/[rfqId]` fetch() with no live server
// during `vitest run`, the same reason Stage 4 retired the equivalent product describe block.

// "Privilege escalation: purchase request approval across tenants" used to live here, testing
// procurementService's mock getPurchaseRequest/decideStep. That domain is now server-side (Phase
// 14, Stage 6) - the equivalent coverage (cross-tenant read refused, a Finance Manager at a
// different company refused despite the matching approver role) now lives in
// server/services/procurement.routes.test.ts, tested against the real database and actual route
// handlers instead of a client-side mock.

// "IDOR: purchase order detail" moved alongside the order blocks above, for the same reason -
// see server/services/orders.routes.test.ts.

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

// "Fabricated dispute: filing a dispute against an order that is not the caller's" moved
// alongside the order/purchase-order blocks above, for the same reason - see
// server/services/orders.routes.test.ts.
