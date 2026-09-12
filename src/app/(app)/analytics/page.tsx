'use client';

import { Wallet, Package, TrendingUp, FileText } from 'lucide-react';
import { useActiveCompany, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { analyticsService } from '@/services/analytics.service';
import { catalogService } from '@/services/catalog.service';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { BarChart, HorizontalBarList } from '@/components/ui/BarChart';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatMoney } from '@/utils/format';
import type { BuyerAnalytics, SupplierAnalytics } from '@/services/analytics.service';
import type { SupplierProfile } from '@/types/catalog';

export default function AnalyticsPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();

  if (workspace === 'platform') {
    return (
      <ErrorState
        title="Not available here"
        description="Platform-wide analytics are part of the platform overview at /admin."
      />
    );
  }

  if (workspace === 'supplier') {
    if (!company) return null;
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;
    return <SupplierAnalyticsView supplier={supplier} />;
  }

  return <BuyerAnalyticsView />;
}

function BuyerAnalyticsView() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data } = useAsyncData<BuyerAnalytics>(companyId, () => analyticsService.getBuyerAnalytics(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Analytics</h1>
        <p className="text-body text-text-secondary">Spend trends and savings for {company?.name}.</p>
      </div>

      {!data ? (
        <AnalyticsSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total spend (paid)" value={formatMoney(data.totalSpend, company?.currency)} icon={Wallet} tone="accent" />
            <StatCard label="Total orders" value={String(data.totalOrders)} icon={Package} />
            <StatCard label="Estimated savings" value={formatMoney(data.estimatedSavings, company?.currency)} icon={TrendingUp} tone="accent" />
            <StatCard
              label="Delivered orders"
              value={String(data.ordersByStatus.find((s) => s.status === 'DELIVERED')?.count ?? 0)}
              icon={Package}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="mb-4 text-h3">Monthly spend</p>
              <BarChart data={data.monthlySpend} valueFormatter={(v) => formatMoney(v, company?.currency)} />
            </div>

            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="mb-4 text-h3">Spend by supplier</p>
              <HorizontalBarList items={data.spendBySupplier} valueFormatter={(v) => formatMoney(v, company?.currency)} />
            </div>
          </div>

          {(data.spendByDepartment.length > 0 || data.spendByCostCenter.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {data.spendByDepartment.length > 0 && (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <p className="mb-4 text-h3">Spend by department</p>
                  <HorizontalBarList items={data.spendByDepartment} valueFormatter={(v) => formatMoney(v, company?.currency)} />
                </div>
              )}
              {data.spendByCostCenter.length > 0 && (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <p className="mb-4 text-h3">Spend by cost center</p>
                  <HorizontalBarList items={data.spendByCostCenter} valueFormatter={(v) => formatMoney(v, company?.currency)} />
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-4 text-h3">Orders by status</p>
            <div className="flex flex-wrap gap-3">
              {data.ordersByStatus.map((s) => (
                <div key={s.status} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <StatusBadge domain="order" status={s.status} />
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SupplierAnalyticsView({ supplier }: { supplier: SupplierProfile }) {
  const { data } = useAsyncData<SupplierAnalytics>(supplier.id, () => analyticsService.getSupplierAnalytics(supplier.id));
  const winRate = data && data.quotesSubmitted > 0 ? Math.round((data.quotesWon / data.quotesSubmitted) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Analytics</h1>
        <p className="text-body text-text-secondary">Revenue and RFQ performance for {supplier.name}.</p>
      </div>

      {!data ? (
        <AnalyticsSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total revenue (paid)" value={formatMoney(data.totalRevenue, 'GHS')} icon={Wallet} tone="accent" />
            <StatCard label="Total orders" value={String(data.totalOrders)} icon={Package} />
            <StatCard label="Quotes submitted" value={String(data.quotesSubmitted)} icon={FileText} />
            <StatCard
              label="RFQ win rate"
              value={winRate === null ? '—' : `${winRate}%`}
              icon={TrendingUp}
              tone={winRate !== null && winRate >= 50 ? 'accent' : 'neutral'}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="mb-4 text-h3">Monthly revenue</p>
              <BarChart data={data.monthlyRevenue} valueFormatter={(v) => formatMoney(v, 'GHS')} />
            </div>

            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="mb-4 text-h3">Revenue by buyer</p>
              <HorizontalBarList items={data.revenueByBuyer} valueFormatter={(v) => formatMoney(v, 'GHS')} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-4 text-h3">Orders by status</p>
            <div className="flex flex-wrap gap-3">
              {data.ordersByStatus.map((s) => (
                <div key={s.status} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <StatusBadge domain="order" status={s.status} />
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
