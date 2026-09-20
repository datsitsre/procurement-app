'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Building2, ShieldCheck, Wallet, Lock, UserCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { catalogService } from '@/services/catalog.service';
import { companyService, type PlatformCompanyRow } from '@/services/company.service';
import { disputesService } from '@/services/disputes.service';
import { auditLogService } from '@/services/audit-log.service';
import { analyticsService } from '@/services/analytics.service';
import { platformUsersService, type PlatformUserRow } from '@/services/platformUsers.service';
import { describeActivity } from '@/lib/activityFeed';
import { Permission } from '@/config/rbac';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { BarChart, HorizontalBarList } from '@/components/ui/BarChart';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatMoney, formatDateTime } from '@/utils/format';
import type { Product, SupplierProfile } from '@/types/catalog';
import type { Dispute } from '@/types/orders';
import type { AuditEntry, CursorPage } from '@/types/common';
import type { PlatformAnalytics } from '@/services/analytics.service';

export default function AdminDashboardPage() {
  return (
    <AdminGuard>
      <AdminDashboard />
    </AdminGuard>
  );
}

function AdminDashboard() {
  const { can } = useAuth();
  // PLATFORM_MANAGER never receives platform.transactions.access (section 5/17 - the whole
  // point of the role split is that platform operations never implies cross-company transaction
  // visibility). Fetching these two widgets anyway would just turn every PLATFORM_MANAGER's
  // Overview into a single full-page error instead of the dashboard it *can* see - so they're
  // skipped entirely for a role that lacks the permission, same as the nav item that links here.
  const hasTransactionsAccess = can(Permission.PLATFORM_TRANSACTIONS_ACCESS);

  const { data: suppliers, error: suppliersError, reload: reloadSuppliers } = useAsyncData<SupplierProfile[]>('admin-suppliers', () => catalogService.listAllSuppliers());
  const { data: products, error: productsError, reload: reloadProducts } = useAsyncData<Product[]>('admin-products', () => catalogService.listAllProductsForModeration());
  // Real GET /api/admin/companies (Phase 26 follow-up) - PLATFORM_TRANSACTIONS_ACCESS only, same
  // as the Companies page itself; replaces the prior localStorage-mock `allCompanies()` read,
  // which could show stale/incomplete browser-local data instead of the real production roster.
  const { data: companies } = useAsyncData<PlatformCompanyRow[]>(hasTransactionsAccess ? 'admin-companies' : null, () => companyService.listAllCompanies());
  const { data: disputes } = useAsyncData<Dispute[]>(hasTransactionsAccess ? 'admin-disputes' : null, () => disputesService.listAllDisputes());
  const { data: analytics, error: analyticsError, reload: reloadAnalytics } = useAsyncData<PlatformAnalytics>(
    hasTransactionsAccess ? 'admin-analytics' : null,
    () => analyticsService.getPlatformAnalytics(),
  );
  // Just the 5 most recent entries for this preview card - the full history lives at
  // /admin/activity (friendly view) and /admin/audit (raw record) - section 16.
  const { data: auditPage, error: auditError, reload: reloadAudit } = useAsyncData<CursorPage<AuditEntry>>('admin-audit', () => auditLogService.listEntries(null, 5));
  const auditEntries = auditPage?.items ?? null;
  // Real pending-registration count (Phase 27) - GET /api/admin/platform/users, held by both
  // platform roles (PLATFORM_USERS_MANAGE), unlike the transaction-gated cards above.
  const { data: platformUsers, error: platformUsersError, reload: reloadPlatformUsers } = useAsyncData<PlatformUserRow[]>(
    'admin-dashboard-platform-users',
    () => platformUsersService.listPlatformUsers(),
  );
  const pendingApprovals = useMemo(() => platformUsers?.filter((u) => u.status === 'PENDING_APPROVAL').length ?? 0, [platformUsers]);

  const error = suppliersError ?? productsError ?? auditError ?? platformUsersError ?? null;
  function retryFailed() {
    if (suppliersError) reloadSuppliers();
    if (productsError) reloadProducts();
    if (auditError) reloadAudit();
    if (platformUsersError) reloadPlatformUsers();
  }

  const pendingSuppliers = useMemo(() => suppliers?.filter((s) => s.verification === 'PENDING_VERIFICATION').length ?? 0, [suppliers]);
  const pendingProducts = useMemo(() => products?.filter((p) => p.moderationStatus === 'PENDING_REVIEW').length ?? 0, [products]);
  const openDisputes = useMemo(
    () => disputes?.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW' || d.status === 'AWAITING_EVIDENCE').length ?? 0,
    [disputes],
  );

  const loading = suppliers === null || products === null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Platform Command Center</h1>
        <p className="text-body text-text-secondary">Monitor your procurement platform, organizations, and activity from one place.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load the platform overview" description={error} secondaryAction={{ label: 'Try again', onClick: retryFailed }} />
      ) : loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {hasTransactionsAccess ? (
            <StatCard label="Companies" value={String(companies?.length ?? 0)} icon={Building2} tone="accent" />
          ) : (
            <StatCard label="Companies" value="—" icon={Lock} />
          )}
          <StatCard label="Suppliers" value={String(suppliers?.length ?? 0)} icon={Building2} tone="accent" />
          <StatCard
            label="Pending approvals"
            value={String(pendingApprovals)}
            icon={UserCheck}
            tone={pendingApprovals > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Awaiting verification"
            value={String(pendingSuppliers + pendingProducts)}
            icon={ShieldCheck}
            tone={pendingSuppliers + pendingProducts > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="mb-3 text-h3">Quick actions</p>
        <div className="flex flex-wrap gap-2">
          {pendingApprovals > 0 && (
            <Link href="/admin/approvals">
              <Button variant="outline" size="sm">
                Review approvals ({pendingApprovals})
              </Button>
            </Link>
          )}
          <Link href="/admin/activity">
            <Button variant="outline" size="sm">
              View activity
            </Button>
          </Link>
          <Link href="/admin/suppliers">
            <Button variant="outline" size="sm">
              Moderate suppliers
            </Button>
          </Link>
          <Link href="/admin/products">
            <Button variant="outline" size="sm">
              Moderate products
            </Button>
          </Link>
        </div>
      </div>

      {hasTransactionsAccess ? (
        <>
          <StatCard
            label="Total platform GMV (paid orders)"
            value={formatMoney(analytics?.totalGmv ?? 0, 'GHS')}
            icon={Wallet}
            tone="accent"
            className="max-w-sm"
          />

          {analyticsError ? (
            <ErrorState title="Couldn't load transaction analytics" description={analyticsError} secondaryAction={{ label: 'Try again', onClick: reloadAnalytics }} />
          ) : (
            analytics && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-surface p-5">
                  <p className="mb-4 text-h3">Monthly GMV</p>
                  <BarChart data={analytics.monthlyGmv} valueFormatter={(v) => formatMoney(v, 'GHS')} />
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-surface p-5">
                    <p className="mb-4 text-h3">Top suppliers</p>
                    <HorizontalBarList items={analytics.gmvBySupplier} valueFormatter={(v) => formatMoney(v, 'GHS')} />
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-5">
                    <p className="mb-4 text-h3">Top buyers</p>
                    <HorizontalBarList items={analytics.gmvByBuyerCompany} valueFormatter={(v) => formatMoney(v, 'GHS')} />
                  </div>
                </div>
              </div>
            )
          )}
        </>
      ) : (
        // Not an error - a Platform Manager's role deliberately excludes cross-company
        // transaction data (section 5). Explains the absence rather than silently omitting the
        // section, so it reads as intentional rather than a broken/missing feature.
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-5 py-4 text-sm text-text-secondary">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Transaction analytics (GMV, disputes) are limited to platform roles with cross-company
          transaction access. Your platform role doesn&rsquo;t include this.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-3 text-h3">Needs your attention</p>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link href="/admin/suppliers" className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-neutral-bg">
                <span>Suppliers awaiting verification</span>
                <span className="font-semibold">{pendingSuppliers}</span>
              </Link>
            </li>
            <li>
              <Link href="/admin/products" className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-neutral-bg">
                <span>Products awaiting review</span>
                <span className="font-semibold">{pendingProducts}</span>
              </Link>
            </li>
            {hasTransactionsAccess && (
              <li>
                <Link href="/admin/disputes" className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-neutral-bg">
                  <span>Open disputes</span>
                  <span className="font-semibold">{openDisputes}</span>
                </Link>
              </li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-h3">Recent activity</p>
            <Link href="/admin/activity" className="text-sm font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          {!auditEntries ? (
            <Skeleton className="h-32" />
          ) : auditEntries.length === 0 ? (
            <p className="text-caption">No activity recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {auditEntries.slice(0, 5).map((entry) => {
                const { label, icon: Icon } = describeActivity(entry);
                return (
                <li key={entry.id} className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="font-medium">{entry.actorName}</span> {label}
                    {entry.companyName && <span className="text-text-secondary"> · {entry.companyName}</span>}
                  </span>
                  <span className="text-caption shrink-0">{formatDateTime(entry.timestamp)}</span>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
