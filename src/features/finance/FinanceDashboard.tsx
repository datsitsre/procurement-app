'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Wallet, Receipt, AlertTriangle, CheckSquare, CreditCard } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { invoicesService } from '@/services/invoices.service';
import { paymentService } from '@/services/payment.service';
import { procurementService } from '@/services/procurement.service';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Skeleton } from '@/components/ui/Skeleton';
import { RoleLabels } from '@/config/rbac';
import { formatDate, formatMoney } from '@/utils/format';
import type { Invoice, Payment } from '@/types/orders';

/**
 * The Finance Manager's own landing page (their role's actual job - invoices, payments,
 * approvals, credit exposure - not the generic buyer dashboard's supplier-discovery framing,
 * which has nothing to do with what this role is granted to do: PAYMENTS_READ/CREATE,
 * INVOICES_READ, PURCHASE_REQUEST_APPROVE, ANALYTICS_READ). Mirrors SupplierDashboard.tsx's own
 * pattern - a role/workspace-specific dashboard swapped in by dashboard/page.tsx - and reuses
 * only data already served by the real backend (invoices, payments, pending approvals); nothing
 * new was added to fetch it.
 */
export function FinanceDashboard() {
  const { session } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const companyId = company?.id ?? null;

  const { data: invoices } = useAsyncData<Invoice[]>(companyId, () => invoicesService.listInvoices(companyId!));
  const { data: payments } = useAsyncData<Payment[]>(companyId, () => paymentService.listPayments(companyId!));

  const approvalsKey = companyId && membership ? `${companyId}:${membership.role}` : null;
  const { data: pendingApprovals } = useAsyncData(approvalsKey, () => procurementService.listPendingApprovals(companyId!, membership!.role));

  const now = new Date();

  const outstanding = useMemo(() => {
    const list = invoices?.filter((i) => i.status === 'PENDING' || i.status === 'PARTIALLY_PAID' || i.status === 'OVERDUE') ?? [];
    return { count: list.length, amount: list.reduce((sum, i) => sum + (i.total - i.amountPaid), 0) };
  }, [invoices]);

  const overdue = useMemo(() => {
    const list = invoices?.filter((i) => i.status === 'OVERDUE') ?? [];
    return { count: list.length, amount: list.reduce((sum, i) => sum + (i.total - i.amountPaid), 0) };
  }, [invoices]);

  const paidThisMonth = useMemo(
    () =>
      payments
        ?.filter((p) => {
          const d = new Date(p.createdAt);
          return p.status === 'PAID' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((sum, p) => sum + p.amount, 0) ?? 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payments],
  );

  const creditUsedPct =
    company?.creditLimit && company.creditLimit > 0
      ? Math.round(((company.creditLimit - (company.creditAvailable ?? company.creditLimit)) / company.creditLimit) * 100)
      : null;

  const invoicesNeedingAttention = useMemo(
    () =>
      (invoices ?? [])
        .filter((i) => i.status === 'PENDING' || i.status === 'PARTIALLY_PAID' || i.status === 'OVERDUE')
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        .slice(0, 6),
    [invoices],
  );

  const recentPayments = payments?.slice(0, 6) ?? [];

  const loading = invoices === null || payments === null || pendingApprovals === null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Finance overview</h1>
        <p className="text-body text-text-secondary">
          {company?.name} · {membership ? RoleLabels[membership.role] : ''} · {session?.user.name.split(' ')[0]}
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
          <StatCard
            label="Outstanding invoices"
            value={`${outstanding.count} · ${formatMoney(outstanding.amount, company?.currency ?? 'GHS')}`}
            icon={Receipt}
            tone={outstanding.count > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Overdue"
            value={`${overdue.count} · ${formatMoney(overdue.amount, company?.currency ?? 'GHS')}`}
            icon={AlertTriangle}
            tone={overdue.count > 0 ? 'danger' : 'neutral'}
          />
          <StatCard label="Paid this month" value={formatMoney(paidThisMonth, company?.currency ?? 'GHS')} icon={Wallet} tone="accent" />
          <StatCard
            label="Pending approvals"
            value={String(pendingApprovals?.length ?? 0)}
            icon={CheckSquare}
            tone={(pendingApprovals?.length ?? 0) > 0 ? 'warning' : 'neutral'}
          />
        </div>
      )}

      {creditUsedPct !== null && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
              <h2 className="text-h3">Credit utilization</h2>
            </div>
            <span className="text-sm text-text-secondary">
              {formatMoney((company!.creditLimit ?? 0) - (company!.creditAvailable ?? 0), company?.currency ?? 'GHS')} of{' '}
              {formatMoney(company!.creditLimit ?? 0, company?.currency ?? 'GHS')} used
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-bg">
            <div
              className={`h-full rounded-full ${creditUsedPct >= 90 ? 'bg-danger' : creditUsedPct >= 70 ? 'bg-warning' : 'bg-accent'}`}
              style={{ width: `${Math.min(100, creditUsedPct)}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-h3">Invoices needing attention</h2>
            <Link href="/invoices" className="text-sm font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          ) : invoicesNeedingAttention.length === 0 ? (
            <p className="p-5 text-caption">Nothing outstanding.</p>
          ) : (
            <ul className="divide-y divide-border">
              {invoicesNeedingAttention.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{i.reference}</p>
                    <p className="text-caption">
                      {i.supplierName} · due {formatDate(i.dueDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <PriceDisplay amount={i.total - i.amountPaid} size="sm" />
                    <StatusBadge domain="invoice" status={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-h3">Recent payments</h2>
            <Link href="/payments" className="text-sm font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          ) : recentPayments.length === 0 ? (
            <p className="p-5 text-caption">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{p.reference}</p>
                    <p className="text-caption">
                      {p.method.replace(/_/g, ' ')} · {formatDate(p.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <PriceDisplay amount={p.amount} size="sm" />
                    <StatusBadge domain="payment" status={p.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
