'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Building2, CheckCircle2, Database, Plus, ShieldCheck, Truck, UserCheck, Users2, Wallet, XCircle, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { catalogService } from '@/services/catalog.service';
import { disputesService } from '@/services/disputes.service';
import { analyticsService } from '@/services/analytics.service';
import { platformOverviewService, type PlatformOverview, type CountBreakdown } from '@/services/platformOverview.service';
import { describeActivity } from '@/lib/activityFeed';
import { Permission } from '@/config/rbac';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { BarChart, HorizontalBarList } from '@/components/ui/BarChart';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { cn } from '@/utils/cn';
import { formatMoney, formatDateTime, formatDate } from '@/utils/format';
import type { Product } from '@/types/catalog';
import type { Dispute } from '@/types/orders';
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
  // PLATFORM_MANAGER never receives platform.transactions.access (section 5/17) - fetching GMV/
  // disputes anyway would just turn every PLATFORM_MANAGER's Overview into a full-page error
  // instead of the dashboard it *can* see, so they're skipped entirely for a role that lacks the
  // permission, same as the nav item that links here.
  const hasTransactionsAccess = can(Permission.PLATFORM_TRANSACTIONS_ACCESS);
  const canCreateCompany = can(Permission.PLATFORM_COMPANIES_CREATE);
  const canCreateSupplier = can(Permission.PLATFORM_SUPPLIERS_CREATE);

  // The dashboard's one consolidated data fetch (GET /api/admin/overview) - every section inside
  // it is independently permission-checked server-side against the caller's real role (never a
  // client-supplied one); a section simply absent from the response means that role doesn't hold
  // the permission it requires, not a loading/error state. See platformOverview.service.ts.
  const { data: overview, error: overviewError, reload: reloadOverview } = useAsyncData<PlatformOverview>('admin-overview', () => platformOverviewService.getOverview());
  const { data: products, error: productsError, reload: reloadProducts } = useAsyncData<Product[]>('admin-products', () => catalogService.listAllProductsForModeration());
  const { data: disputes } = useAsyncData<Dispute[]>(hasTransactionsAccess ? 'admin-disputes' : null, () => disputesService.listAllDisputes());
  const { data: analytics, error: analyticsError, reload: reloadAnalytics } = useAsyncData<PlatformAnalytics>(
    hasTransactionsAccess ? 'admin-analytics' : null,
    () => analyticsService.getPlatformAnalytics(),
  );

  const error = overviewError ?? productsError ?? null;
  function retryFailed() {
    if (overviewError) reloadOverview();
    if (productsError) reloadProducts();
  }

  const pendingProducts = useMemo(() => products?.filter((p) => p.moderationStatus === 'PENDING_REVIEW').length ?? 0, [products]);
  const openDisputes = useMemo(
    () => disputes?.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW' || d.status === 'AWAITING_EVIDENCE').length ?? 0,
    [disputes],
  );

  const loading = overview === null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">Platform Command Center</h1>
          <p className="text-body text-text-secondary">Monitor your procurement platform, organizations, and activity from one place.</p>
        </div>
        {(canCreateCompany || canCreateSupplier) && (
          <div className="flex flex-wrap gap-2">
            {canCreateCompany && (
              <Link href="/admin/companies">
                <Button size="sm">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add company
                </Button>
              </Link>
            )}
            {canCreateSupplier && (
              <Link href="/admin/suppliers">
                <Button size="sm" variant={canCreateCompany ? 'outline' : 'primary'}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add supplier
                </Button>
              </Link>
            )}
          </div>
        )}
      </div>

      {error ? (
        <ErrorState title="Couldn't load the platform overview" description={error} secondaryAction={{ label: 'Try again', onClick: retryFailed }} />
      ) : loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {overview.companies ? (
              <BreakdownCard
                title="Companies"
                icon={Building2}
                href="/admin/companies"
                total={overview.companies.total}
                rows={[
                  { label: 'Active', value: overview.companies.active, tone: 'success' },
                  { label: 'Suspended', value: overview.companies.suspended, tone: 'danger' },
                ]}
              />
            ) : (
              <LockedCard title="Companies" icon={Lock} />
            )}

            {overview.suppliers ? (
              <BreakdownCard
                title="Suppliers"
                icon={Truck}
                href="/admin/suppliers"
                total={overview.suppliers.total}
                rows={[
                  { label: 'Verified', value: overview.suppliers.verified, tone: 'success' },
                  { label: 'Suspended', value: overview.suppliers.suspended, tone: 'danger' },
                ]}
              />
            ) : (
              <LockedCard title="Suppliers" icon={Lock} />
            )}

            {overview.users ? (
              <BreakdownCard
                title="Platform users"
                icon={Users2}
                href="/admin/users"
                total={overview.users.total}
                rows={[
                  { label: 'Active', value: overview.users.active, tone: 'success' },
                  { label: 'Suspended', value: overview.users.suspended, tone: 'danger' },
                ]}
              />
            ) : (
              <LockedCard title="Platform users" icon={Lock} />
            )}

            {overview.approvals ? (
              <Link
                href="/admin/approvals"
                className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent/50"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-metadata">
                    <UserCheck className="h-4 w-4" aria-hidden="true" />
                    Pending approvals
                  </span>
                  <span className="text-h1">{overview.approvals.total}</span>
                </div>
                <Badge tone={overview.approvals.total > 0 ? 'warning' : 'neutral'} className="w-fit">
                  {overview.approvals.total > 0 ? 'Needs review' : 'All caught up'}
                </Badge>
              </Link>
            ) : (
              <LockedCard title="Pending approvals" icon={Lock} />
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <OrganizationStatusCard companies={overview.companies} />
            <SystemStatusCard database={overview.systemStatus.database} api={overview.systemStatus.api} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <PendingApprovalsCard approvals={overview.approvals} />
            <RecentActivityCard activity={overview.activity} hasAccess={overview.activity !== undefined} />
          </div>
        </>
      )}

      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="mb-3 text-h3">Quick actions</p>
        <div className="flex flex-wrap gap-2">
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

      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="mb-3 text-h3">Needs your attention</p>
        <ul className="flex flex-col gap-2 text-sm">
          {overview?.suppliers && (
            <li>
              <Link href="/admin/suppliers" className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-neutral-bg">
                <span>Suppliers awaiting verification</span>
                <span className="font-semibold">{overview.suppliers.pendingVerification}</span>
              </Link>
            </li>
          )}
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
    </div>
  );
}

const DOT_TONE_CLASSES: Record<'success' | 'danger' | 'warning' | 'neutral', string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  neutral: 'bg-neutral-text',
};

/** One of the four dashboard summary cards (Companies/Suppliers/Platform users) - a big total
 *  plus a small breakdown row, the whole card a link to the page that owns this data (section
 *  3's "clickable when a corresponding destination already exists" - never a fake link). */
function BreakdownCard({
  title,
  icon: Icon,
  href,
  total,
  rows,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  total: number;
  rows: { label: string; value: number; tone: 'success' | 'danger' | 'warning' | 'neutral' }[];
}) {
  return (
    <Link href={href} className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent/50">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-metadata">
          <Icon className="h-4 w-4" aria-hidden="true" />
          {title}
        </span>
        <span className="text-h1">{total}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {rows.map((r) => (
          <span key={r.label} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', DOT_TONE_CLASSES[r.tone])} aria-hidden="true" />
            {r.label} <span className="font-semibold">{r.value}</span>
          </span>
        ))}
      </div>
    </Link>
  );
}

/** A summary card a role lacks the permission for - shown as an honest "not part of your role"
 *  state, never a broken/forbidden-looking card and never a fabricated zero (section 8/10). */
function LockedCard({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border border-dashed border-border bg-surface p-5 text-text-tertiary">
      <span className="flex items-center gap-2 text-metadata">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {title}
      </span>
      <p className="text-caption">Not available right now.</p>
    </div>
  );
}

/** A lightweight, dependency-free active/suspended breakdown (section 4) - a single proportional
 *  two-segment bar, the same "a handful of proportional divs" philosophy BarChart.tsx already
 *  established for this app rather than pulling in a charting library for a donut. */
function OrganizationStatusCard({ companies }: { companies: CountBreakdown | undefined }) {
  if (!companies) {
    return (
      <div className="flex flex-col justify-center gap-2 rounded-lg border border-dashed border-border bg-surface p-5 text-text-tertiary">
        <p className="text-h3 text-text-tertiary">Organization status</p>
        <p className="text-caption">Not available right now.</p>
      </div>
    );
  }

  const activePct = companies.total > 0 ? (companies.active / companies.total) * 100 : 0;
  const suspendedPct = companies.total > 0 ? 100 - activePct : 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-h3">Organization status</p>
        <Link href="/admin/companies" className="text-sm font-medium text-accent hover:underline">
          View all
        </Link>
      </div>
      <p className="text-h1">{companies.total}</p>
      <p className="mb-4 text-caption">Total organizations</p>

      {companies.total > 0 && (
        <div className="mb-4 flex h-2 w-full overflow-hidden rounded-full bg-neutral-bg" role="img" aria-label={`${companies.active} active, ${companies.suspended} suspended`}>
          {activePct > 0 && <div className="h-full bg-success" style={{ width: `${activePct}%` }} />}
          {suspendedPct > 0 && <div className="h-full bg-danger" style={{ width: `${suspendedPct}%` }} />}
        </div>
      )}

      <div className="flex items-center gap-6 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
          Active <span className="font-semibold">{companies.active}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
          Suspended <span className="font-semibold">{companies.suspended}</span>
        </span>
      </div>
    </div>
  );
}

/** Only the checks this app can genuinely back are shown (section 7) - Database (the same raw
 *  SELECT 1 GET /api/health and GET /api/ready already run) and API (true by construction: this
 *  card only renders because the API just answered). No "Authentication"/"Background Jobs" row -
 *  nothing in this app monitors either, and a fabricated "Healthy" for a system with no real
 *  check is exactly what this dashboard must never show. */
function SystemStatusCard({ database, api }: { database: 'healthy' | 'unavailable'; api: 'healthy' }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="mb-4 text-h3">System status</p>
      <ul className="flex flex-col gap-3">
        <SystemStatusRow icon={Database} label="Database" status={database} />
        <SystemStatusRow icon={CheckCircle2} label="API" status={api} />
      </ul>
      <p className="mt-4 text-caption text-text-tertiary">Checked on page load - the same database connectivity check GET /api/health uses.</p>
    </div>
  );
}

function SystemStatusRow({ icon: Icon, label, status }: { icon: LucideIcon; label: string; status: 'healthy' | 'unavailable' }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
      <span className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
        {label}
      </span>
      {status === 'healthy' ? (
        <Badge tone="success">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Healthy
        </Badge>
      ) : (
        <Badge tone="danger">
          <XCircle className="h-3 w-3" aria-hidden="true" /> Unavailable
        </Badge>
      )}
    </li>
  );
}

/** A compact preview of the exact same pending-registration queue /admin/approvals shows in
 *  full (section 6) - reuses that page's own data (CompanyMembership.status === PENDING_APPROVAL)
 *  via the shared overview endpoint; approving/rejecting stays on /admin/approvals rather than a
 *  second action surface here. */
function PendingApprovalsCard({ approvals }: { approvals: PlatformOverview['approvals'] }) {
  if (!approvals) {
    return (
      <div className="flex flex-col justify-center gap-2 rounded-lg border border-dashed border-border bg-surface p-5 text-text-tertiary">
        <p className="text-h3 text-text-tertiary">Pending approvals</p>
        <p className="text-caption">Not available right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-h3">Pending approvals</p>
        <Link href="/admin/approvals" className="text-sm font-medium text-accent hover:underline">
          View all
        </Link>
      </div>
      {approvals.total === 0 ? (
        <EmptyState icon={CheckCircle2} title="You're all caught up" description="No pending approvals require attention." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-table">
            <thead>
              <tr className="text-metadata">
                <th className="py-2 text-left">Type</th>
                <th className="py-2 text-left">Name</th>
                <th className="py-2 text-left">Submitted</th>
                <th className="py-2 text-left">Status</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {approvals.items.map((item) => (
                <tr key={`${item.userId}-${item.companyId}`} className="border-t border-border">
                  <td className="py-2.5">Registration</td>
                  <td className="py-2.5">
                    <p className="font-medium">{item.userName}</p>
                    <p className="text-caption">{item.companyName}</p>
                  </td>
                  <td className="py-2.5 text-text-secondary">{formatDate(item.submittedAt)}</td>
                  <td className="py-2.5">
                    <Badge tone="warning">Pending</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    <Link href="/admin/approvals" className="text-sm font-medium text-accent hover:underline">
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The dashboard's compact activity feed (section 5) - sourced from the exact same AuditLog
 *  rows/scope GET /api/audit-log already serves, formatted with the exact same describeActivity
 *  helper /admin/activity uses. Never a second activity system. */
function RecentActivityCard({ activity, hasAccess }: { activity: PlatformOverview['activity']; hasAccess: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-h3">Recent activity</p>
        <Link href="/admin/activity" className="text-sm font-medium text-accent hover:underline">
          View all
        </Link>
      </div>
      {!hasAccess ? (
        <p className="text-caption text-text-tertiary">Not available right now.</p>
      ) : !activity ? (
        <EmptyState icon={ShieldCheck} title="No activity yet" description="Recent platform actions will show up here once they happen." />
      ) : activity.length === 0 ? (
        <p className="text-caption">No activity recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {activity.map((entry) => {
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
  );
}
