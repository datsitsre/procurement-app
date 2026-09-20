import {
  LayoutDashboard,
  Package,
  Building2,
  FileText,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Receipt,
  Wallet,
  BarChart3,
  Users,
  Settings,
  ShoppingCart,
  PiggyBank,
  Scale,
  AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Permission } from './rbac';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden entirely for a role that lacks this permission - not just disabled. */
  permission?: Permission;
}

/** Full desktop sidebar for the buyer workspace (section 9/69). Mobile shows a subset of
 *  these via the bottom nav - see config/navigation.ts's `buyerBottomNav`. */
export const buyerNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package, permission: 'orders.read' },
  { label: 'Catalog', href: '/catalog', icon: ShoppingCart, permission: 'products.read' },
  { label: 'Suppliers', href: '/suppliers', icon: Building2, permission: 'suppliers.read' },
  { label: 'RFQs', href: '/rfqs', icon: FileText, permission: 'rfq.create' },
  { label: 'Purchase requests', href: '/purchase-requests', icon: ClipboardCheck, permission: 'purchase_request.create' },
  { label: 'Approvals', href: '/approvals', icon: CheckSquare, permission: 'purchase_request.approve' },
  { label: 'Purchase orders', href: '/purchase-orders', icon: ClipboardList, permission: 'purchase_order.create' },
  { label: 'Budgets', href: '/budgets', icon: PiggyBank, permission: 'analytics.read' },
  { label: 'Invoices', href: '/invoices', icon: Receipt, permission: 'invoices.read' },
  { label: 'Payments', href: '/payments', icon: Wallet, permission: 'payments.read' },
  { label: 'Disputes', href: '/disputes', icon: AlertTriangle, permission: 'orders.read' },
  { label: 'Balance sheet', href: '/balance-sheet', icon: Scale, permission: 'invoices.read' },
  { label: 'Analytics', href: '/analytics', icon: BarChart3, permission: 'analytics.read' },
  { label: 'Team', href: '/team', icon: Users, permission: 'users.manage' },
  { label: 'Audit log', href: '/audit-log', icon: ClipboardList, permission: 'audit.view' },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export const buyerBottomNav: NavItem[] = [
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package, permission: 'orders.read' },
  { label: 'Catalog', href: '/catalog', icon: ShoppingCart, permission: 'products.read' },
  { label: 'Analytics', href: '/analytics', icon: BarChart3, permission: 'analytics.read' },
];

export const supplierBottomNav: NavItem[] = [
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package, permission: 'orders.read' },
  { label: 'Products', href: '/products', icon: ShoppingCart, permission: 'products.read' },
  { label: 'RFQs', href: '/rfqs', icon: FileText, permission: 'rfq.respond' },
];

/** Supplier workspace sidebar (SUPPLIER_ADMIN / SUPPLIER_STAFF). Every item that either role
 *  might lack now carries its backend `Permission` (src/config/rbac.ts) - previously none of
 *  these did, so SUPPLIER_STAFF (which holds only ORDERS_READ/ORDERS_FULFILL/RFQ_RESPOND/
 *  PRODUCTS_READ/PRODUCTS_MANAGE) saw Team/Settings-management/Analytics/Payments/Invoices/
 *  Balance sheet/Audit log links it could never actually use - a company-admin-only surface
 *  shown to plain staff. */
export const supplierNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package, permission: 'orders.read' },
  { label: 'Products', href: '/products', icon: ShoppingCart, permission: 'products.read' },
  { label: 'RFQs', href: '/rfqs', icon: FileText, permission: 'rfq.respond' },
  { label: 'Invoices', href: '/invoices', icon: Receipt, permission: 'invoices.read' },
  { label: 'Payments', href: '/payments', icon: Wallet, permission: 'payments.read' },
  { label: 'Disputes', href: '/disputes', icon: AlertTriangle, permission: 'orders.read' },
  { label: 'Balance sheet', href: '/balance-sheet', icon: Scale, permission: 'invoices.read' },
  { label: 'Team', href: '/team', icon: Users, permission: 'users.manage' },
  { label: 'Audit log', href: '/audit-log', icon: ClipboardList, permission: 'audit.view' },
  { label: 'Analytics', href: '/analytics', icon: BarChart3, permission: 'analytics.read' },
  { label: 'Settings', href: '/settings', icon: Settings },
];

/** Platform-administration sidebar (PLATFORM_MANAGER / PLATFORM_SUPER_ADMIN / legacy
 *  PLATFORM_ADMIN). Unlike buyerNav/supplierNav, every item that isn't universally available to
 *  every platform role now carries the exact `Permission` the backend route it points at
 *  actually checks (src/config/rbac.ts) - PLATFORM_MANAGER holds the platform-operations
 *  permissions but deliberately NOT `platform.transactions.access`, so Orders/Payments/Disputes
 *  are hidden for it here, matching the tenant-isolation bypass it never receives server-side
 *  (server/auth/context.ts's resolveTenant). Hiding the link is a UX convenience only - the
 *  routes themselves (and AdminGuard on every /admin/* page) remain the real boundary. */
export const platformNav: NavItem[] = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
  // The company directory is real cross-company business data (every buyer's roster), gated the
  // same as Orders/Payments/Disputes - see /api/admin/companies's own comment for why this isn't
  // "just metadata" PLATFORM_MANAGER gets for free.
  { label: 'Companies', href: '/admin/companies', icon: Building2, permission: 'platform.transactions.access' },
  { label: 'Suppliers', href: '/admin/suppliers', icon: Building2, permission: 'platform.catalog.moderate' },
  { label: 'Products', href: '/admin/products', icon: ShoppingCart, permission: 'platform.catalog.moderate' },
  { label: 'Orders', href: '/admin/orders', icon: Package, permission: 'platform.transactions.access' },
  { label: 'Payments', href: '/admin/payments', icon: Wallet, permission: 'platform.transactions.access' },
  { label: 'Disputes', href: '/admin/disputes', icon: FileText, permission: 'platform.transactions.access' },
  { label: 'Audit log', href: '/admin/audit', icon: ClipboardList, permission: 'platform.audit.view' },
  { label: 'Platform users', href: '/admin/platform/users', icon: Users, permission: 'platform.users.manage' },
  { label: 'Settings', href: '/settings', icon: Settings, permission: 'platform.settings.manage' },
];
