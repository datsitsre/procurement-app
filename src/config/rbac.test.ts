import { describe, expect, it } from 'vitest';
import { Role, Permission, hasPermission, hasAnyPermission, workspaceForRole } from './rbac';

describe('hasPermission', () => {
  it('grants a permission explicitly listed for the role', () => {
    expect(hasPermission(Role.PROCUREMENT_MANAGER, Permission.PURCHASE_REQUEST_APPROVE)).toBe(true);
  });

  it('refuses a permission not listed for the role', () => {
    expect(hasPermission(Role.BUYER, Permission.PURCHASE_ORDER_CREATE)).toBe(false);
  });

  it('never grants anything to an unrecognized role key', () => {
    expect(hasPermission('NOT_A_ROLE' as Role, Permission.ORDERS_READ)).toBe(false);
  });
});

describe('hasAnyPermission', () => {
  it('is true if at least one of the permissions is granted', () => {
    expect(hasAnyPermission(Role.BUYER, [Permission.PURCHASE_ORDER_CREATE, Permission.RFQ_CREATE])).toBe(true);
  });

  it('is false when none of the permissions are granted', () => {
    expect(hasAnyPermission(Role.SUPPLIER_STAFF, [Permission.PURCHASE_ORDER_CREATE, Permission.PLATFORM_MANAGE])).toBe(false);
  });
});

describe('workspaceForRole', () => {
  it('routes every buyer-side role to the buyer workspace', () => {
    for (const role of [Role.OWNER, Role.ADMIN, Role.PROCUREMENT_MANAGER, Role.BUYER, Role.FINANCE_MANAGER, Role.APPROVER, Role.EMPLOYEE]) {
      expect(workspaceForRole(role)).toBe('buyer');
    }
  });

  it('routes supplier roles to the supplier workspace', () => {
    expect(workspaceForRole(Role.SUPPLIER_ADMIN)).toBe('supplier');
    expect(workspaceForRole(Role.SUPPLIER_STAFF)).toBe('supplier');
  });

  it('routes the platform admin role to the platform workspace', () => {
    expect(workspaceForRole(Role.PLATFORM_ADMIN)).toBe('platform');
  });
});

describe('RBAC separation of duties (regression guard)', () => {
  // A procurement manager must be able to both authorize a PO and pay for it - otherwise
  // accepting a quote creates a purchase order nobody with that authority can ever check out.
  it('procurement manager can both create purchase orders and initiate payments', () => {
    expect(hasPermission(Role.PROCUREMENT_MANAGER, Permission.PURCHASE_ORDER_CREATE)).toBe(true);
    expect(hasPermission(Role.PROCUREMENT_MANAGER, Permission.PAYMENTS_CREATE)).toBe(true);
  });

  // A plain buyer can request quotes and submit purchase requests, but committing spend via a
  // purchase order is reserved for a more senior role - see acceptQuote's permission gate.
  it('a plain buyer cannot authorize a purchase order', () => {
    expect(hasPermission(Role.BUYER, Permission.PURCHASE_ORDER_CREATE)).toBe(false);
  });
});

describe('Platform organization management permissions (Phase 28)', () => {
  const ORG_PERMISSIONS = [
    Permission.PLATFORM_COMPANIES_VIEW,
    Permission.PLATFORM_COMPANIES_CREATE,
    Permission.PLATFORM_COMPANIES_UPDATE,
    Permission.PLATFORM_SUPPLIERS_CREATE,
    Permission.PLATFORM_SUPPLIERS_UPDATE,
    Permission.PLATFORM_MEMBERS_VIEW,
  ];

  it('PLATFORM_SUPER_ADMIN holds every new organization-management permission', () => {
    for (const permission of ORG_PERMISSIONS) {
      expect(hasPermission(Role.PLATFORM_SUPER_ADMIN, permission)).toBe(true);
    }
  });

  it('legacy PLATFORM_ADMIN remains permission-equivalent to PLATFORM_SUPER_ADMIN for these too', () => {
    for (const permission of ORG_PERMISSIONS) {
      expect(hasPermission(Role.PLATFORM_ADMIN, permission)).toBe(hasPermission(Role.PLATFORM_SUPER_ADMIN, permission));
    }
  });

  it('PLATFORM_MANAGER holds none of the new organization-management permissions', () => {
    for (const permission of ORG_PERMISSIONS) {
      expect(hasPermission(Role.PLATFORM_MANAGER, permission)).toBe(false);
    }
  });

  it('PLATFORM_MANAGER retains its existing catalog-moderation permission unchanged', () => {
    expect(hasPermission(Role.PLATFORM_MANAGER, Permission.PLATFORM_CATALOG_MODERATE)).toBe(true);
  });

  it('no company-side role holds any platform organization-management permission', () => {
    for (const role of [Role.OWNER, Role.ADMIN, Role.SUPPLIER_ADMIN]) {
      for (const permission of ORG_PERMISSIONS) {
        expect(hasPermission(role, permission)).toBe(false);
      }
    }
  });
});
