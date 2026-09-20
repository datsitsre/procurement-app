import { describe, expect, it } from 'vitest';
import { Role, hasPermission } from './rbac';
import { buyerNav, platformNav, supplierNav } from './navigation';

/** Which nav items a role would actually see, applying the exact filter Sidebar/BottomNav/
 *  MorePage all use (`!item.permission || hasPermission(role, item.permission)`) - a pure-function
 *  test of the same visibility rule every real nav-rendering component shares, so a regression
 *  here means every one of those components would regress too. */
function visibleLabels(items: typeof platformNav, role: Role): string[] {
  return items.filter((item) => !item.permission || hasPermission(role, item.permission)).map((item) => item.label);
}

describe('platformNav (section 3/4/5/10 - the platform-manager isolation UI depends on this)', () => {
  it('PLATFORM_MANAGER never sees transaction-access items (Orders/Payments/Disputes/Companies)', () => {
    const visible = visibleLabels(platformNav, Role.PLATFORM_MANAGER);
    expect(visible).not.toContain('Orders');
    expect(visible).not.toContain('Payments');
    expect(visible).not.toContain('Disputes');
    // Companies is a full cross-company customer roster, not platform-operations metadata (see
    // /api/admin/companies's own comment) - gated the same as Orders/Payments/Disputes.
    expect(visible).not.toContain('Companies');
  });

  it('PLATFORM_MANAGER still sees its own platform-operations items', () => {
    const visible = visibleLabels(platformNav, Role.PLATFORM_MANAGER);
    expect(visible).toContain('Overview');
    expect(visible).toContain('Suppliers');
    expect(visible).toContain('Products');
    expect(visible).toContain('Audit log');
    expect(visible).toContain('Platform users');
    expect(visible).toContain('Settings');
  });

  it('PLATFORM_SUPER_ADMIN sees every platform nav item, including transaction access', () => {
    const visible = visibleLabels(platformNav, Role.PLATFORM_SUPER_ADMIN);
    expect(visible).toEqual(platformNav.map((item) => item.label));
  });

  it('legacy PLATFORM_ADMIN remains permission-equivalent to PLATFORM_SUPER_ADMIN', () => {
    expect(visibleLabels(platformNav, Role.PLATFORM_ADMIN)).toEqual(visibleLabels(platformNav, Role.PLATFORM_SUPER_ADMIN));
  });

  it('Platform users management is reachable only by roles that can act on it', () => {
    const platformUsersItem = platformNav.find((item) => item.label === 'Platform users');
    expect(platformUsersItem).toBeDefined();
    expect(hasPermission(Role.PLATFORM_MANAGER, platformUsersItem!.permission!)).toBe(true);
    expect(hasPermission(Role.PLATFORM_SUPER_ADMIN, platformUsersItem!.permission!)).toBe(true);
  });
});

describe('supplierNav (section 7 - SUPPLIER_STAFF must not see company-admin-only sections)', () => {
  it('SUPPLIER_STAFF does not see Team/Settings-management/Analytics/Payments/Invoices/Balance sheet/Audit log', () => {
    const visible = visibleLabels(supplierNav, Role.SUPPLIER_STAFF);
    expect(visible).not.toContain('Team');
    expect(visible).not.toContain('Analytics');
    expect(visible).not.toContain('Payments');
    expect(visible).not.toContain('Invoices');
    expect(visible).not.toContain('Balance sheet');
    expect(visible).not.toContain('Audit log');
  });

  it('SUPPLIER_STAFF still sees its own operational items', () => {
    const visible = visibleLabels(supplierNav, Role.SUPPLIER_STAFF);
    expect(visible).toContain('Orders');
    expect(visible).toContain('Products');
    expect(visible).toContain('RFQs');
    expect(visible).toContain('Disputes');
  });

  it('SUPPLIER_ADMIN sees every supplier nav item', () => {
    const visible = visibleLabels(supplierNav, Role.SUPPLIER_ADMIN);
    expect(visible).toEqual(supplierNav.map((item) => item.label));
  });
});

describe('buyerNav (section 6 - a company role only sees what it can act on)', () => {
  it('EMPLOYEE does not see Approvals/Purchase orders/Payments/Team/Analytics', () => {
    const visible = visibleLabels(buyerNav, Role.EMPLOYEE);
    expect(visible).not.toContain('Approvals');
    expect(visible).not.toContain('Purchase orders');
    expect(visible).not.toContain('Payments');
    expect(visible).not.toContain('Team');
    expect(visible).not.toContain('Analytics');
  });

  it('OWNER sees every buyer nav item', () => {
    const visible = visibleLabels(buyerNav, Role.OWNER);
    expect(visible).toEqual(buyerNav.map((item) => item.label));
  });
});
