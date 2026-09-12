'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Building2, ShieldCheck, Package, Wallet, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { allCompanies } from '@/services/auth.service';
import { catalogService } from '@/services/catalog.service';
import { disputesService } from '@/services/disputes.service';
import { ordersService } from '@/services/orders.service';
import { auditLogService } from '@/services/audit-log.service';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney, formatDateTime } from '@/utils/format';
import type { Product, SupplierProfile } from '@/types/catalog';
import type { Dispute, Order } from '@/types/orders';
import type { AuditEntry } from '@/types/common';

export default function AdminDashboardPage() {
  return (
    <AdminGuard>
      <AdminDashboard />
    </AdminGuard>
  );
}

function AdminDashboard() {
  const { session } = useAuth();
  const { data: suppliers } = useAsyncData<SupplierProfile[]>('admin-suppliers', () => catalogService.listAllSuppliers());
  const { data: products } = useAsyncData<Product[]>('admin-products', () => catalogService.listAllProductsForModeration());
  const { data: disputes } = useAsyncData<Dispute[]>('admin-disputes', () => disputesService.listAllDisputes());
  const { data: orders } = useAsyncData<Order[]>('admin-orders', () => ordersService.listAllOrders());
  const { data: auditEntries } = useAsyncData<AuditEntry[]>('admin-audit', () => auditLogService.listEntries());

  const buyerCompanies = useMemo(() => allCompanies().filter((c) => c.isBuyer), []);
  const pendingSuppliers = useMemo(() => suppliers?.filter((s) => s.verification === 'PENDING_VERIFICATION').length ?? 0, [suppliers]);
  const pendingProducts = useMemo(() => products?.filter((p) => p.moderationStatus === 'PENDING_REVIEW').length ?? 0, [products]);
  const openDisputes = useMemo(
    () => disputes?.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW' || d.status === 'AWAITING_EVIDENCE').length ?? 0,
    [disputes],
  );
  const gmv = useMemo(() => orders?.filter((o) => o.paymentStatus === 'PAID').reduce((sum, o) => sum + o.total, 0) ?? 0, [orders]);

  const loading = suppliers === null || products === null || disputes === null || orders === null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Good day, {session?.user.name.split(' ')[0]}</h1>
        <p className="text-body text-text-secondary">Platform overview.</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Buyer companies" value={String(buyerCompanies.length)} icon={Building2} />
          <StatCard label="Suppliers" value={String(suppliers?.length ?? 0)} icon={Building2} />
          <StatCard
            label="Pending verification"
            value={String(pendingSuppliers)}
            icon={ShieldCheck}
            tone={pendingSuppliers > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Products to review"
            value={String(pendingProducts)}
            icon={Package}
            tone={pendingProducts > 0 ? 'warning' : 'neutral'}
          />
          <StatCard label="Open disputes" value={String(openDisputes)} icon={AlertTriangle} tone={openDisputes > 0 ? 'danger' : 'neutral'} />
        </div>
      )}

      <StatCard label="Total platform GMV (paid orders)" value={formatMoney(gmv, 'GHS')} icon={Wallet} tone="accent" className="max-w-sm" />

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
            <li>
              <Link href="/admin/disputes" className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-neutral-bg">
                <span>Open disputes</span>
                <span className="font-semibold">{openDisputes}</span>
              </Link>
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-h3">Recent activity</p>
            <Link href="/admin/audit" className="text-sm font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          {!auditEntries ? (
            <Skeleton className="h-32" />
          ) : auditEntries.length === 0 ? (
            <p className="text-caption">No activity recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {auditEntries.slice(0, 5).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{entry.actorName}</span> {entry.action.toLowerCase().replace(/_/g, ' ')}
                  </span>
                  <span className="text-caption shrink-0">{formatDateTime(entry.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
