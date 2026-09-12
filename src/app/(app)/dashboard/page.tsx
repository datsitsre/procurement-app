'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Wallet, Package, CheckSquare, FileText, Receipt, Star, ShieldCheck } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { SupplierDashboard } from '@/features/supplier/SupplierDashboard';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { procurementService } from '@/services/procurement.service';
import { catalogService } from '@/services/catalog.service';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Skeleton } from '@/components/ui/Skeleton';
import { RoleLabels } from '@/config/rbac';
import { formatDate } from '@/utils/format';
import type { Order } from '@/types/orders';
import type { Invoice } from '@/types/orders';
import type { RFQ } from '@/types/procurement';
import type { SupplierProfile } from '@/types/catalog';

export default function DashboardPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();

  if (workspace === 'supplier') {
    if (!company) return null;
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;
    return <SupplierDashboard supplier={supplier} />;
  }

  return <BuyerDashboard />;
}

function BuyerDashboard() {
  const { session } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  const companyId = company?.id ?? null;
  const { data: orders } = useAsyncData<Order[]>(companyId, () => ordersService.listOrders(companyId!));
  const { data: invoices } = useAsyncData<Invoice[]>(companyId, () => invoicesService.listInvoices(companyId!));
  const { data: rfqs } = useAsyncData<RFQ[]>(companyId, () => procurementService.listRfqs(companyId!));

  const approvalsKey = companyId && membership ? `${companyId}:${membership.role}` : null;
  const { data: pendingApprovals } = useAsyncData(approvalsKey, () => procurementService.listPendingApprovals(companyId!, membership!.role));
  const pendingApprovalCount = pendingApprovals?.length ?? null;

  const [suppliers, setSuppliers] = useState<SupplierProfile[]>([]);
  useEffect(() => {
    catalogService.listSuppliers().then((r) => r.ok && setSuppliers(r.data));
  }, []);

  const now = new Date();

  const totalSpend = useMemo(
    () => orders?.filter((o) => o.paymentStatus === 'PAID').reduce((sum, o) => sum + o.total, 0) ?? 0,
    [orders],
  );

  const monthlySpend = useMemo(
    () =>
      orders
        ?.filter((o) => {
          const d = new Date(o.createdAt);
          return o.paymentStatus === 'PAID' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((sum, o) => sum + o.total, 0) ?? 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders],
  );

  const openOrders = useMemo(() => orders?.filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length ?? 0, [orders]);

  const pendingRfqs = useMemo(
    () => rfqs?.filter((r) => !['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'DRAFT'].includes(r.status)).length ?? 0,
    [rfqs],
  );

  const outstandingInvoices = useMemo(() => {
    const list = invoices?.filter((i) => i.status === 'PENDING' || i.status === 'OVERDUE') ?? [];
    return { count: list.length, amount: list.reduce((sum, i) => sum + (i.total - i.amountPaid), 0) };
  }, [invoices]);

  const recentOrders = orders?.slice(0, 4) ?? [];
  const recommendedSuppliers = [...suppliers].sort((a, b) => b.rating - a.rating).slice(0, 3);

  const loading = orders === null || invoices === null || rfqs === null || pendingApprovalCount === null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Good day, {session?.user.name.split(' ')[0]}</h1>
        <p className="text-body text-text-secondary">
          {company?.name} · {membership ? RoleLabels[membership.role] : ''}
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total spend" value={formatShort(totalSpend, company?.currency)} icon={Wallet} tone="accent" />
          <StatCard label="Monthly spend" value={formatShort(monthlySpend, company?.currency)} icon={Wallet} />
          <StatCard label="Open orders" value={String(openOrders)} icon={Package} />
          <StatCard
            label="Pending approvals"
            value={String(pendingApprovalCount)}
            icon={CheckSquare}
            tone={pendingApprovalCount! > 0 ? 'warning' : 'neutral'}
          />
          <StatCard label="Pending RFQs" value={String(pendingRfqs)} icon={FileText} />
          <StatCard
            label="Outstanding invoices"
            value={`${outstandingInvoices.count} · ${formatShort(outstandingInvoices.amount, company?.currency)}`}
            icon={Receipt}
            tone={outstandingInvoices.count > 0 ? 'danger' : 'neutral'}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-h3">Recent orders</h2>
            <Link href="/orders" className="text-sm font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          ) : recentOrders.length === 0 ? (
            <p className="p-5 text-caption">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{o.reference}</p>
                    <p className="text-caption">
                      {o.supplierName} · {formatDate(o.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <PriceDisplay amount={o.total} size="sm" />
                    <StatusBadge domain="order" status={o.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-h3">Recommended suppliers</h2>
          </div>
          <ul className="divide-y divide-border">
            {recommendedSuppliers.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {s.name}
                    {(s.verification === 'VERIFIED' || s.verification === 'PREMIUM_VERIFIED') && (
                      <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                    )}
                  </p>
                  <p className="text-caption">{s.categories.join(', ')}</p>
                </div>
                <span className="flex items-center gap-1 text-sm">
                  <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
                  {s.rating.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function formatShort(amount: number, currency?: string): string {
  const symbol = currency === 'GHS' ? '₵' : currency === 'NGN' ? '₦' : currency === 'KES' ? 'KSh' : '';
  if (amount >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${symbol}${(amount / 1_000).toFixed(1)}K`;
  return `${symbol}${amount}`;
}
