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
  /** Legacy platform role - kept for backward compatibility with accounts created before the
   *  manager/super-admin split below; granted the same permissions as PLATFORM_SUPER_ADMIN so no
   *  existing account regresses. Do not grant this role to new accounts - use one of the two
   *  below instead. */
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  /** Platform operations - manages platform users, settings, registration approvals, and
   *  catalog moderation. Deliberately does NOT receive the tenant-isolation bypass (see
   *  server/auth/context.ts's resolveTenant) or any company-transaction permission - being a
   *  platform administrator must never mean "sees every company's data." */
  PLATFORM_MANAGER: 'PLATFORM_MANAGER',
  /** The exceptional, system-wide role. The only role besides the legacy PLATFORM_ADMIN that
   *  receives the tenant-isolation bypass, for cross-company troubleshooting - every such access
   *  is expected to be audited (see PLATFORM_TRANSACTIONS_ACCESS's own comment). */
  PLATFORM_SUPER_ADMIN: 'PLATFORM_SUPER_ADMIN',
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
export const PLATFORM_ROLES: Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MANAGER, Role.PLATFORM_SUPER_ADMIN];

/** Roles that receive the ownsRecord() tenant-isolation bypass (server/auth/context.ts) - a
 *  strictly narrower set than PLATFORM_ROLES. PLATFORM_MANAGER is deliberately excluded: it's a
 *  platform role, but not one authorized to read/write another company's transactional data. */
export const CROSS_TENANT_ROLES: Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_SUPER_ADMIN];

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

  // Company-level audit trail (own company only - see /api/companies/[companyId]/audit-log)
  AUDIT_VIEW: 'audit.view',

  // Platform administration - kept for backward compatibility; every route that used to check
  // only this now also accepts the finer-grained permissions below (see each route's own diff).
  PLATFORM_MANAGE: 'platform.manage',

  // Platform operations - granted to both PLATFORM_MANAGER and PLATFORM_SUPER_ADMIN (and the
  // legacy PLATFORM_ADMIN). None of these grant access to a specific company's transactions.
  PLATFORM_SETTINGS_MANAGE: 'platform.settings.manage',
  PLATFORM_USERS_MANAGE: 'platform.users.manage',
  PLATFORM_REGISTRATION_APPROVE: 'platform.registration.approve',
  /** Product/supplier listing moderation and verification - a platform quality-control function,
   *  not access to any company's procurement transactions. */
  PLATFORM_CATALOG_MODERATE: 'platform.catalog.moderate',
  /** View the platform-wide audit trail. PLATFORM_MANAGER's view is filtered to platform-action
   *  entries only (see audit.service.ts's listAuditLog `scope` param) - it does not imply
   *  PLATFORM_TRANSACTIONS_ACCESS. */
  PLATFORM_AUDIT_VIEW: 'platform.audit.view',

  // Platform super-admin only - the exceptional, cross-company capabilities.
  /** Manage platform-tier role assignments (who is a PLATFORM_MANAGER/PLATFORM_SUPER_ADMIN) -
   *  never granted to PLATFORM_MANAGER, which would otherwise let a manager promote themselves. */
  PLATFORM_ROLES_MANAGE: 'platform.roles.manage',
  /** Cross-company transactional access - orders, payments, disputes, invoices, budgets,
   *  analytics, recurring purchases. This is the one permission that actually exposes another
   *  company's business data to platform staff, and it is granted ONLY to PLATFORM_SUPER_ADMIN
   *  (and the legacy PLATFORM_ADMIN) - never to PLATFORM_MANAGER. */
  PLATFORM_TRANSACTIONS_ACCESS: 'platform.transactions.access',

  // Platform organization management (Phase 28) - deliberately separate from
  // PLATFORM_TRANSACTIONS_ACCESS: viewing/managing the *directory* of registered organizations
  // (who exists, their profile metadata) is a distinct capability from viewing their orders/
  // payments/disputes. Granted ONLY to PLATFORM_SUPER_ADMIN (and legacy PLATFORM_ADMIN) - never
  // to PLATFORM_MANAGER, matching the same "no cross-company business data" boundary
  // PLATFORM_TRANSACTIONS_ACCESS already draws. There is deliberately no
  // PLATFORM_COMPANIES_SUSPEND/PLATFORM_COMPANIES_DELETE permission yet - Company has no status
  // field to suspend with, and every one of its business-record relations (Order, Invoice,
  // Payment, PurchaseRequest, PurchaseOrder, RFQ, Budget, ...) cascade-deletes, so neither
  // capability exists to gate (see ACCESS_CONTROL_IMPLEMENTATION_REPORT.md's Phase 28 section).
  /** View the platform-wide company directory - GET /api/admin/companies. Replaces
   *  PLATFORM_TRANSACTIONS_ACCESS as that route's gate (Phase 28) now that a dedicated
   *  organization-management permission exists; the actual set of roles that pass it is
   *  unchanged (Super Admin/legacy Admin only). */
  PLATFORM_COMPANIES_VIEW: 'platform.companies.view',
  /** Create a new buyer company as a platform administrator (Phase 28) - distinct from a
   *  prospective customer's own self-registration flow (POST /api/auth/register), which always
   *  starts PENDING_APPROVAL and is never gated on a permission at all. */
  PLATFORM_COMPANIES_CREATE: 'platform.companies.create',
  /** Edit an existing company's own profile metadata as a platform administrator (Phase 28) -
   *  distinct from PATCH /api/companies/[companyId] (SETTINGS_MANAGE), which is that company's
   *  own OWNER/ADMIN editing their own profile, not a platform admin editing someone else's. */
  PLATFORM_COMPANIES_UPDATE: 'platform.companies.update',
  /** Create a new supplier profile (+ its own platform-created Company row) as a platform
   *  administrator (Phase 28). Deliberately separate from PLATFORM_CATALOG_MODERATE, which
   *  governs *moderating already-existing* suppliers/products (verify/reject/suspend), not
   *  bringing a brand-new one onto the platform - PLATFORM_MANAGER keeps the former, not this. */
  PLATFORM_SUPPLIERS_CREATE: 'platform.suppliers.create',
  /** Edit an existing supplier's profile metadata (name, city, description, categories, ...) as
   *  a platform administrator (Phase 28) - distinct from the verification-status decision
   *  (VERIFIED/SUSPENDED/REJECTED), which already has its own dedicated route and permission
   *  (PLATFORM_CATALOG_MODERATE, PATCH /api/suppliers/[supplierId]/verification) and needed no
   *  change. */
  PLATFORM_SUPPLIERS_UPDATE: 'platform.suppliers.update',
  /** View a specific company's or supplier's own member/team list from the platform admin side
   *  (Phase 28) - GET /api/admin/companies/[companyId]/members and
   *  GET /api/admin/suppliers/[supplierId]/members. Deliberately its own permission, not
   *  USERS_MANAGE (a company-role-only permission neither platform role holds) and deliberately
   *  NOT a platform-wide "list every user at every company" capability - each call is scoped to
   *  one already-identified organization, never a global directory (see platformUsers.service.ts's
   *  own comment on why that distinction matters). PLATFORM_MANAGER does not hold this. */
  PLATFORM_MEMBERS_VIEW: 'platform.members.view',
  /** Suspend a company - POST /api/admin/companies/[companyId]/suspend (Phase 28 follow-up).
   *  Super Admin/legacy Admin only, same as every other PLATFORM_COMPANIES_* permission - a
   *  PLATFORM_MANAGER must never be able to cut off a company's access to the platform. */
  PLATFORM_COMPANIES_SUSPEND: 'platform.companies.suspend',
  /** Reactivate a suspended company - POST /api/admin/companies/[companyId]/activate. Kept as
   *  its own permission (not folded into PLATFORM_COMPANIES_SUSPEND) so a future, narrower role
   *  could someday hold one without the other - both are granted together today, to the same
   *  roles, but the vocabulary stays precise either way. */
  PLATFORM_COMPANIES_ACTIVATE: 'platform.companies.activate',
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
  Permission.AUDIT_VIEW,
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
    // Whoever can authorize a purchase order must also be able to check it out / pay it -
    // otherwise a procurement manager could create a PO but never actually complete the
    // purchase, which isn't a real separation of duties, just a dead end.
    Permission.PAYMENTS_CREATE,
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
    Permission.AUDIT_VIEW,
  ],
  [Role.SUPPLIER_STAFF]: [
    Permission.ORDERS_READ,
    Permission.ORDERS_FULFILL,
    Permission.RFQ_RESPOND,
    Permission.PRODUCTS_READ,
    Permission.PRODUCTS_MANAGE,
  ],
  // Platform operations only - explicitly excludes PLATFORM_TRANSACTIONS_ACCESS and
  // PLATFORM_ROLES_MANAGE. A PLATFORM_MANAGER can run the platform; it cannot see a single
  // company's purchase requests, orders, invoices, payments, budgets, or recurring purchases,
  // and it cannot promote itself or anyone else to a platform role.
  [Role.PLATFORM_MANAGER]: [
    Permission.PLATFORM_SETTINGS_MANAGE,
    Permission.PLATFORM_USERS_MANAGE,
    Permission.PLATFORM_REGISTRATION_APPROVE,
    Permission.PLATFORM_CATALOG_MODERATE,
    Permission.PLATFORM_AUDIT_VIEW,
  ],
  // The exceptional, system-wide role - everything PLATFORM_MANAGER has, plus the permissions
  // that actually cross a tenant boundary (transactions, role management, organization
  // management). See each PLATFORM_COMPANIES_*/PLATFORM_SUPPLIERS_*/PLATFORM_MEMBERS_VIEW
  // permission's own doc comment above for why these are deliberately separate from
  // PLATFORM_TRANSACTIONS_ACCESS rather than reusing it.
  [Role.PLATFORM_SUPER_ADMIN]: [
    Permission.PLATFORM_MANAGE,
    Permission.PLATFORM_SETTINGS_MANAGE,
    Permission.PLATFORM_USERS_MANAGE,
    Permission.PLATFORM_REGISTRATION_APPROVE,
    Permission.PLATFORM_CATALOG_MODERATE,
    Permission.PLATFORM_AUDIT_VIEW,
    Permission.PLATFORM_ROLES_MANAGE,
    Permission.PLATFORM_TRANSACTIONS_ACCESS,
    Permission.PLATFORM_COMPANIES_VIEW,
    Permission.PLATFORM_COMPANIES_CREATE,
    Permission.PLATFORM_COMPANIES_UPDATE,
    Permission.PLATFORM_COMPANIES_SUSPEND,
    Permission.PLATFORM_COMPANIES_ACTIVATE,
    Permission.PLATFORM_SUPPLIERS_CREATE,
    Permission.PLATFORM_SUPPLIERS_UPDATE,
    Permission.PLATFORM_MEMBERS_VIEW,
    Permission.ANALYTICS_READ,
  ],
  // Legacy role - kept permission-equivalent to PLATFORM_SUPER_ADMIN so accounts created before
  // this split (including any already in production) do not lose access. Do not grant this role
  // to new accounts.
  [Role.PLATFORM_ADMIN]: [
    Permission.PLATFORM_MANAGE,
    Permission.PLATFORM_SETTINGS_MANAGE,
    Permission.PLATFORM_USERS_MANAGE,
    Permission.PLATFORM_REGISTRATION_APPROVE,
    Permission.PLATFORM_CATALOG_MODERATE,
    Permission.PLATFORM_AUDIT_VIEW,
    Permission.PLATFORM_ROLES_MANAGE,
    Permission.PLATFORM_TRANSACTIONS_ACCESS,
    Permission.PLATFORM_COMPANIES_VIEW,
    Permission.PLATFORM_COMPANIES_CREATE,
    Permission.PLATFORM_COMPANIES_UPDATE,
    Permission.PLATFORM_COMPANIES_SUSPEND,
    Permission.PLATFORM_COMPANIES_ACTIVATE,
    Permission.PLATFORM_SUPPLIERS_CREATE,
    Permission.PLATFORM_SUPPLIERS_UPDATE,
    Permission.PLATFORM_MEMBERS_VIEW,
    Permission.ANALYTICS_READ,
  ],
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
  [Role.PLATFORM_ADMIN]: 'Platform administrator (legacy)',
  [Role.PLATFORM_MANAGER]: 'Platform manager',
  [Role.PLATFORM_SUPER_ADMIN]: 'Platform super admin',
};

/** Role-escalation guard (section 24) - who may assign a given platform-tier role to someone.
 *  Only PLATFORM_SUPER_ADMIN (or the legacy PLATFORM_ADMIN) may grant PLATFORM_MANAGER or
 *  PLATFORM_SUPER_ADMIN - a PLATFORM_MANAGER can never promote itself or anyone else to a
 *  platform role, matching the "Platform Manager cannot become Super Admin" rule. Not used for
 *  company-level roles - see BUYER_ROLES/SUPPLIER_ROLES's own allowlist checks in
 *  company.service.ts, which already exclude platform roles from what any company can grant. */
export function canAssignPlatformRole(actorRole: Role): boolean {
  return actorRole === Role.PLATFORM_SUPER_ADMIN || actorRole === Role.PLATFORM_ADMIN;
}
