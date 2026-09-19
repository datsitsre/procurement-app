'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wallet, Package, CheckSquare, FileText, Receipt, Star, ShieldCheck } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { SupplierDashboard } from '@/features/supplier/SupplierDashboard';
import { FinanceDashboard } from '@/features/finance/FinanceDashboard';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { procurementService } from '@/services/procurement.service';
import { catalogService } from '@/services/catalog.service';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { RoleLabels } from '@/config/rbac';
import { formatDate } from '@/utils/format';
import type { SupplierProfile } from '@/types/catalog';

export default function DashboardPage() {
  const router = useRouter();
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  // The platform workspace's home is /admin, not this buyer/supplier dashboard - login always
  // lands here first (it has no way to know the workspace ahead of time), so bounce onward.
  useEffect(() => {
    if (workspace === 'platform') router.replace('/admin');
  }, [workspace, router]);

  if (workspace === 'platform') return null;

  if (workspace === 'supplier') {
    if (!company) return null;
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;
    return <SupplierDashboard supplier={supplier} />;
  }

  // Finance Manager's job is invoices/payments/approvals/credit exposure, not supplier
  // discovery - the generic BuyerDashboard's own framing has nothing to do with that role.
  if (membership?.role === 'FINANCE_MANAGER') return <FinanceDashboard />;

  return <BuyerDashboard />;
}

function BuyerDashboard() {
  const { session } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  const companyId = company?.id ?? null;
  // Totals are computed server-side via real database aggregation (Phase 16), never by loading
  // every order into the browser and summing in JS - `listOrders` itself is paginated now, so a
  // page of it alone could never produce a correct all-time/monthly total for a company with more
  // than one page of order history.
  const { data: orderSummary, error: orderSummaryError, reload: reloadOrderSummary } = useAsyncData(companyId, () => ordersService.getOrderSummary(companyId!));
  const { data: recentOrdersPage, error: recentOrdersError, reload: reloadRecentOrders } = useAsyncData(companyId, () => ordersService.listOrders(companyId!, 1, 4));
  // Real database aggregation (Phase 19) - never loaded/summed from the full invoice/RFQ history,
  // which is now paginated and could span many pages for a long-lived account.
  const { data: invoiceAging, error: invoicesError, reload: reloadInvoices } = useAsyncData(companyId, () => invoicesService.getInvoiceAgingSummary(companyId!));
  const { data: pendingRfqs, error: rfqsError, reload: reloadRfqs } = useAsyncData(companyId, () => procurementService.getRfqPendingCount(companyId!));

  const approvalsKey = companyId && membership ? `${companyId}:${membership.role}` : null;
  const { data: pendingApprovals, error: approvalsError, reload: reloadApprovals } = useAsyncData(approvalsKey, () => procurementService.listPendingApprovals(companyId!, membership!.role));
  const pendingApprovalCount = pendingApprovals?.length ?? null;

  // One combined error surface (section 5's frontend-failure audit) - a dashboard is several
  // independent data sources at once, so a single failed one shouldn't need its own dedicated
  // error card; retrying re-fetches only the source(s) that actually failed.
  const error = orderSummaryError ?? recentOrdersError ?? invoicesError ?? rfqsError ?? approvalsError ?? null;
  function retryFailed() {
    if (orderSummaryError) reloadOrderSummary();
    if (recentOrdersError) reloadRecentOrders();
    if (invoicesError) reloadInvoices();
    if (rfqsError) reloadRfqs();
    if (approvalsError) reloadApprovals();
  }

  const [suppliers, setSuppliers] = useState<SupplierProfile[]>([]);
  useEffect(() => {
    catalogService.listSuppliers().then((r) => r.ok && setSuppliers(r.data));
  }, []);

  const totalSpend = orderSummary?.totalSpend ?? 0;
  const monthlySpend = orderSummary?.monthlySpend ?? 0;
  const openOrders = orderSummary?.openOrders ?? 0;

  const outstandingInvoices = { count: invoiceAging?.count ?? 0, amount: invoiceAging?.total ?? 0 };

  const recentOrders = recentOrdersPage?.items ?? [];
  const recommendedSuppliers = [...suppliers].sort((a, b) => b.rating - a.rating).slice(0, 3);

  const loading = orderSummary === null || recentOrdersPage === null || invoiceAging === null || pendingRfqs === null || pendingApprovalCount === null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Good day, {session?.user.name.split(' ')[0]}</h1>
        <p className="text-body text-text-secondary">
          {company?.name} · {membership ? RoleLabels[membership.role] : ''}
        </p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load your dashboard" description={error} secondaryAction={{ label: 'Try again', onClick: retryFailed }} />
      ) : loading ? (
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
          <StatCard label="Pending RFQs" value={String(pendingRfqs ?? 0)} icon={FileText} />
          <StatCard
            label="Outstanding invoices"
            value={`${outstandingInvoices.count} · ${formatShort(outstandingInvoices.amount, company?.currency)}`}
            icon={Receipt}
            tone={outstandingInvoices.count > 0 ? 'danger' : 'neutral'}
          />
        </div>
      )}

      {!error && (
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
      )}
    </div>
  );
}

function formatShort(amount: number, currency?: string): string {
  const symbol = currency === 'GHS' ? '₵' : currency === 'NGN' ? '₦' : currency === 'KES' ? 'KSh' : '';
  if (amount >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${symbol}${(amount / 1_000).toFixed(1)}K`;
  return `${symbol}${amount}`;
}
