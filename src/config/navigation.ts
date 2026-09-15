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
  { label: 'Balance sheet', href: '/balance-sheet', icon: Scale, permission: 'invoices.read' },
  { label: 'Analytics', href: '/analytics', icon: BarChart3, permission: 'analytics.read' },
  { label: 'Team', href: '/team', icon: Users, permission: 'users.manage' },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export const buyerBottomNav: NavItem[] = [
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package },
  { label: 'Catalog', href: '/catalog', icon: ShoppingCart },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
];

export const supplierBottomNav: NavItem[] = [
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package },
  { label: 'Products', href: '/products', icon: ShoppingCart },
  { label: 'RFQs', href: '/rfqs', icon: FileText },
];

export const supplierNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', href: '/orders', icon: Package },
  { label: 'Products', href: '/products', icon: ShoppingCart },
  { label: 'RFQs', href: '/rfqs', icon: FileText },
  { label: 'Invoices', href: '/invoices', icon: Receipt },
  { label: 'Payments', href: '/payments', icon: Wallet },
  { label: 'Balance sheet', href: '/balance-sheet', icon: Scale },
  { label: 'Team', href: '/team', icon: Users },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export const platformNav: NavItem[] = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
  { label: 'Companies', href: '/admin/companies', icon: Building2 },
  { label: 'Suppliers', href: '/admin/suppliers', icon: Building2 },
  { label: 'Products', href: '/admin/products', icon: ShoppingCart },
  { label: 'Orders', href: '/admin/orders', icon: Package },
  { label: 'Payments', href: '/admin/payments', icon: Wallet },
  { label: 'Disputes', href: '/admin/disputes', icon: FileText },
  { label: 'Audit log', href: '/admin/audit', icon: ClipboardList },
];
