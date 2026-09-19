'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { FileText, Package, AlertTriangle, Wallet, Receipt } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { ordersService } from '@/services/orders.service';
import { catalogService } from '@/services/catalog.service';
import { paymentService } from '@/services/payment.service';
import { invoicesService } from '@/services/invoices.service';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { availableStock } from '@/types/catalog';
import { formatDate, formatMoney } from '@/utils/format';
import type { Product, SupplierProfile } from '@/types/catalog';

export function SupplierDashboard({ supplier }: { supplier: SupplierProfile }) {
  const { session } = useAuth();
  const supplierId = supplier.id;

  // Real database counts/aggregations (Phase 19) - never derived from a page of the now-
  // paginated RFQ/payment/invoice lists, which could each span many pages for a busy supplier.
  const { data: pendingRfqs, error: rfqsError, reload: reloadRfqs } = useAsyncData(supplierId, () => procurementService.getRfqPendingCountForSupplier(supplierId));
  // Just the 5 most recent orders for the preview list below - not the full history, and not
  // used to derive any count (see ordersToFulfill, a real server-side count instead).
  const {
    data: recentOrdersPage,
    error: recentOrdersError,
    reload: reloadRecentOrders,
  } = useAsyncData(supplierId, () => ordersService.listOrdersForSupplier(supplierId, 1, 5));
  const {
    data: ordersToFulfill,
    error: ordersToFulfillError,
    reload: reloadOrdersToFulfill,
  } = useAsyncData(supplierId, () => ordersService.getSupplierOrdersToFulfillCount(supplierId));
  const {
    data: products,
    error: productsError,
    reload: reloadProducts,
  } = useAsyncData<Product[]>(supplierId, () => catalogService.listProductsForSupplier(supplierId));
  const {
    data: monthlyRevenue,
    error: paymentsError,
    reload: reloadPayments,
  } = useAsyncData(supplierId, () => paymentService.getPaidThisMonthTotalForSupplier(supplierId));
  const {
    data: invoiceAging,
    error: invoicesError,
    reload: reloadInvoices,
  } = useAsyncData(supplierId, () => invoicesService.getInvoiceAgingSummaryForSupplier(supplierId));

  const error = rfqsError ?? recentOrdersError ?? ordersToFulfillError ?? productsError ?? paymentsError ?? invoicesError ?? null;
  function retryFailed() {
    if (rfqsError) reloadRfqs();
    if (recentOrdersError) reloadRecentOrders();
    if (ordersToFulfillError) reloadOrdersToFulfill();
    if (productsError) reloadProducts();
    if (paymentsError) reloadPayments();
    if (invoicesError) reloadInvoices();
  }

  const lowStockProducts = useMemo(
    () => products?.filter((p) => p.inventory.some((i) => i.stock - i.reserved <= i.lowStockThreshold)) ?? [],
    [products],
  );

  const outstandingInvoiceTotal = invoiceAging?.total ?? 0;

  const recentOrders = recentOrdersPage?.items ?? [];
  const loading =
    pendingRfqs === null || recentOrdersPage === null || ordersToFulfill === null || products === null || monthlyRevenue === null || invoiceAging === null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h1">Good day, {session?.user.name.split(' ')[0]}</h1>
          <p className="text-body text-text-secondary">{supplier.name} · Supplier workspace</p>
        </div>
        <Link href="/balance-sheet" className="text-sm font-medium text-accent hover:underline">
          View balance sheet
        </Link>
      </div>

      {error ? (
        <ErrorState title="Couldn't load your supplier overview" description={error} secondaryAction={{ label: 'Try again', onClick: retryFailed }} />
      ) : loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard
            label="RFQs to respond to"
            value={String(pendingRfqs ?? 0)}
            icon={FileText}
            tone={(pendingRfqs ?? 0) > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Orders to fulfill"
            value={String(ordersToFulfill ?? 0)}
            icon={Package}
            tone={(ordersToFulfill ?? 0) > 0 ? 'accent' : 'neutral'}
          />
          <StatCard
            label="Low stock products"
            value={String(lowStockProducts.length)}
            icon={AlertTriangle}
            tone={lowStockProducts.length > 0 ? 'danger' : 'neutral'}
          />
          <StatCard label="Revenue this month" value={formatMoney(monthlyRevenue ?? 0, 'GHS')} icon={Wallet} tone="accent" />
          <StatCard
            label="Outstanding invoices"
            value={formatMoney(outstandingInvoiceTotal, 'GHS')}
            icon={Receipt}
            tone={outstandingInvoiceTotal > 0 ? 'warning' : 'neutral'}
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
                    <p className="text-caption">{formatDate(o.createdAt)}</p>
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
            <h2 className="text-h3">Low stock</h2>
          </div>
          {lowStockProducts.length === 0 ? (
            <p className="p-5 text-caption">Everything is stocked above its threshold.</p>
          ) : (
            <ul className="divide-y divide-border">
              {lowStockProducts.map((p) => {
                const stock = availableStock(p);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-caption">{p.sku}</p>
                    </div>
                    <span className="text-sm font-medium text-danger">{stock} left</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
