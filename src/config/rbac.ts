/**
 * Role-based access control. This module is the single source of truth for what each role
 * can do - both the UI (to hide/disable actions a user can't perform) and, in a real backend,
 * the API layer (to reject requests a user isn't authorized to make) must consult it.
 *
 * IMPORTANT: frontend permission checks are a UX convenience only, never a security boundary.
 * Every mutating mock service call in src/services also re-checks the caller's permission
 * before "succeeding", so the pattern is in place for a real API to do the same - see
 * services/base.ts's `assertPermission`.
 */

export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  PROCUREMENT_MANAGER: 'PROCUREMENT_MANAGER',
  BUYER: 'BUYER',
  FINANCE_MANAGER: 'FINANCE_MANAGER',
  APPROVER: 'APPROVER',
  EMPLOYEE: 'EMPLOYEE',
  SUPPLIER_ADMIN: 'SUPPLIER_ADMIN',
  SUPPLIER_STAFF: 'SUPPLIER_STAFF',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const BUYER_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.PROCUREMENT_MANAGER,
  Role.BUYER,
  Role.FINANCE_MANAGER,
  Role.APPROVER,
  Role.EMPLOYEE,
];
export const SUPPLIER_ROLES: Role[] = [Role.SUPPLIER_ADMIN, Role.SUPPLIER_STAFF];
export const PLATFORM_ROLES: Role[] = [Role.PLATFORM_ADMIN];

/** Which "workspace" a role signs into - drives which app shell + nav a user sees. */
export type Workspace = 'buyer' | 'supplier' | 'platform';

export function workspaceForRole(role: Role): Workspace {
  if (SUPPLIER_ROLES.includes(role)) return 'supplier';
  if (PLATFORM_ROLES.includes(role)) return 'platform';
  return 'buyer';
}

export const Permission = {
  // Orders
  ORDERS_READ: 'orders.read',
  ORDERS_CREATE: 'orders.create',
  ORDERS_APPROVE: 'orders.approve',
  ORDERS_CANCEL: 'orders.cancel',
  /** Supplier-side: advance an order through processing/dispatch/delivery (section 29/44). */
  ORDERS_FULFILL: 'orders.fulfill',

  // RFQs
  RFQ_CREATE: 'rfq.create',
  RFQ_RESPOND: 'rfq.respond',

  // Purchase requests / approvals
  PURCHASE_REQUEST_CREATE: 'purchase_request.create',
  PURCHASE_REQUEST_APPROVE: 'purchase_request.approve',

  // Purchase orders
  PURCHASE_ORDER_CREATE: 'purchase_order.create',

  // Payments / invoices
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_CREATE: 'payments.create',
  INVOICES_READ: 'invoices.read',

  // Suppliers (buyer side: manage relationships; supplier side: manage own listing)
  SUPPLIERS_READ: 'suppliers.read',
  SUPPLIERS_MANAGE: 'suppliers.manage',

  // Products / catalog
  PRODUCTS_READ: 'products.read',
  PRODUCTS_MANAGE: 'products.manage',

  // Team / users
  USERS_MANAGE: 'users.manage',

  // Analytics
  ANALYTICS_READ: 'analytics.read',

  // Settings (approval-rule config, company profile, etc.)
  SETTINGS_MANAGE: 'settings.manage',

  // Platform administration
  PLATFORM_MANAGE: 'platform.manage',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL_BUYER_PERMISSIONS: Permission[] = [
  Permission.ORDERS_READ,
  Permission.ORDERS_CREATE,
  Permission.ORDERS_APPROVE,
  Permission.ORDERS_CANCEL,
  Permission.RFQ_CREATE,
  Permission.PURCHASE_REQUEST_CREATE,
  Permission.PURCHASE_REQUEST_APPROVE,
  Permission.PURCHASE_ORDER_CREATE,
  Permission.PAYMENTS_READ,
  Permission.PAYMENTS_CREATE,
  Permission.INVOICES_READ,
  Permission.SUPPLIERS_READ,
  Permission.SUPPLIERS_MANAGE,
  Permission.PRODUCTS_READ,
  Permission.USERS_MANAGE,
  Permission.ANALYTICS_READ,
  Permission.SETTINGS_MANAGE,
];

/** Role -> permission grants. Deliberately explicit (no wildcard "owner gets everything")
 *  so adding a new permission always forces a conscious decision about who gets it. */
export const RolePermissions: Record<Role, Permission[]> = {
  [Role.OWNER]: ALL_BUYER_PERMISSIONS,
  [Role.ADMIN]: ALL_BUYER_PERMISSIONS,
  [Role.PROCUREMENT_MANAGER]: [
    Permission.ORDERS_READ,
    Permission.ORDERS_CREATE,
    Permission.RFQ_CREATE,
    Permission.PURCHASE_REQUEST_CREATE,
    // The default approval rules (section 23) name "Procurement manager" as the first-line
    // approver for mid-tier spend bands, so this role must be able to act on that step -
    // without it, a request routed to a procurement manager could never be approved by one.
    Permission.PURCHASE_REQUEST_APPROVE,
    Permission.PURCHASE_ORDER_CREATE,
    Permission.SUPPLIERS_READ,
    Permission.SUPPLIERS_MANAGE,
    Permission.PRODUCTS_READ,
    Permission.INVOICES_READ,
    Permission.ANALYTICS_READ,
  ],
  [Role.BUYER]: [
    Permission.ORDERS_READ,
    Permission.ORDERS_CREATE,
    Permission.RFQ_CREATE,
    Permission.PURCHASE_REQUEST_CREATE,
    Permission.SUPPLIERS_READ,
    Permission.PRODUCTS_READ,
  ],
  [Role.FINANCE_MANAGER]: [
    Permission.ORDERS_READ,
    Permission.PURCHASE_REQUEST_APPROVE,
    Permission.PAYMENTS_READ,
    Permission.PAYMENTS_CREATE,
    Permission.INVOICES_READ,
    Permission.ANALYTICS_READ,
  ],
  [Role.APPROVER]: [Permission.ORDERS_READ, Permission.PURCHASE_REQUEST_APPROVE],
  [Role.EMPLOYEE]: [
    Permission.ORDERS_READ,
    Permission.PURCHASE_REQUEST_CREATE,
    Permission.PRODUCTS_READ,
  ],
  [Role.SUPPLIER_ADMIN]: [
    Permission.ORDERS_READ,
    Permission.ORDERS_FULFILL,
    Permission.RFQ_RESPOND,
    Permission.PRODUCTS_READ,
    Permission.PRODUCTS_MANAGE,
    Permission.PAYMENTS_READ,
    Permission.INVOICES_READ,
    Permission.USERS_MANAGE,
    Permission.ANALYTICS_READ,
    Permission.SETTINGS_MANAGE,
  ],
  [Role.SUPPLIER_STAFF]: [
    Permission.ORDERS_READ,
    Permission.ORDERS_FULFILL,
    Permission.RFQ_RESPOND,
    Permission.PRODUCTS_READ,
    Permission.PRODUCTS_MANAGE,
  ],
  [Role.PLATFORM_ADMIN]: [Permission.PLATFORM_MANAGE, Permission.ANALYTICS_READ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return RolePermissions[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/** Human-readable role labels for UI display (team list, invite dialog, etc.). */
export const RoleLabels: Record<Role, string> = {
  [Role.OWNER]: 'Company owner',
  [Role.ADMIN]: 'Administrator',
  [Role.PROCUREMENT_MANAGER]: 'Procurement manager',
  [Role.BUYER]: 'Purchasing officer',
  [Role.FINANCE_MANAGER]: 'Finance manager',
  [Role.APPROVER]: 'Approver',
  [Role.EMPLOYEE]: 'Employee',
  [Role.SUPPLIER_ADMIN]: 'Supplier administrator',
  [Role.SUPPLIER_STAFF]: 'Supplier staff',
  [Role.PLATFORM_ADMIN]: 'Platform administrator',
};
