'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { FileText, Package, AlertTriangle, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { ordersService } from '@/services/orders.service';
import { catalogService } from '@/services/catalog.service';
import { paymentService } from '@/services/payment.service';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Skeleton } from '@/components/ui/Skeleton';
import { availableStock } from '@/types/catalog';
import { formatDate, formatMoney } from '@/utils/format';
import type { RFQ } from '@/types/procurement';
import type { Order, Payment } from '@/types/orders';
import type { Product, SupplierProfile } from '@/types/catalog';

export function SupplierDashboard({ supplier }: { supplier: SupplierProfile }) {
  const { session } = useAuth();
  const supplierId = supplier.id;

  const { data: rfqs } = useAsyncData<RFQ[]>(supplierId, () => procurementService.listRfqsForSupplier(supplierId));
  const { data: orders } = useAsyncData<Order[]>(supplierId, () => ordersService.listOrdersForSupplier(supplierId));
  const { data: products } = useAsyncData<Product[]>(supplierId, () => catalogService.listProductsForSupplier(supplierId));
  const { data: payments } = useAsyncData<Payment[]>(supplierId, () => paymentService.listPaymentsForSupplier(supplierId));

  const pendingRfqs = useMemo(
    () => rfqs?.filter((r) => r.suppliers.find((s) => s.supplierId === supplierId)?.status === 'INVITED').length ?? 0,
    [rfqs, supplierId],
  );

  const ordersToFulfill = useMemo(
    () => orders?.filter((o) => o.status === 'CONFIRMED' || o.status === 'PROCESSING').length ?? 0,
    [orders],
  );

  const lowStockProducts = useMemo(
    () => products?.filter((p) => p.inventory.some((i) => i.stock - i.reserved <= i.lowStockThreshold)) ?? [],
    [products],
  );

  const now = new Date();
  const monthlyRevenue = useMemo(
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

  const recentOrders = orders?.slice(0, 5) ?? [];
  const loading = rfqs === null || orders === null || products === null || payments === null;

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

      {loading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="RFQs to respond to"
            value={String(pendingRfqs)}
            icon={FileText}
            tone={pendingRfqs > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Orders to fulfill"
            value={String(ordersToFulfill)}
            icon={Package}
            tone={ordersToFulfill > 0 ? 'accent' : 'neutral'}
          />
          <StatCard
            label="Low stock products"
            value={String(lowStockProducts.length)}
            icon={AlertTriangle}
            tone={lowStockProducts.length > 0 ? 'danger' : 'neutral'}
          />
          <StatCard label="Revenue this month" value={formatMoney(monthlyRevenue, 'GHS')} icon={Wallet} tone="accent" />
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
    </div>
  );
}
