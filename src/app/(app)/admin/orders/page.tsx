'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { ordersService } from '@/services/orders.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { formatDate } from '@/utils/format';
import type { Page } from '@/types/common';
import type { Order } from '@/types/orders';

const PAGE_SIZE = 25;

export default function AdminOrdersPage() {
  return (
    <AdminGuard>
      <OrdersOverview />
    </AdminGuard>
  );
}

function OrdersOverview() {
  const [page, setPage] = useState(1);
  const { data: result, error, reload } = useAsyncData<Page<Order>>(`admin-orders-list-${page}`, () => ordersService.listAllOrders(page, PAGE_SIZE));
  const orders = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Orders</h1>
        <p className="text-body text-text-secondary">Every order placed across the platform.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load orders" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : orders === null ? (
        <SkeletonTable rows={5} columns={6} />
      ) : orders.length === 0 ? (
        <EmptyState icon={Package} title="No orders yet" description="Orders placed across the platform will appear here." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-table">
              <thead>
                <tr className="text-metadata">
                  <th className="p-4 text-left">Order</th>
                  <th className="p-4 text-left">Buyer</th>
                  <th className="p-4 text-left">Supplier</th>
                  <th className="p-4 text-left">Date</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="p-4 font-medium">{o.reference}</td>
                    <td className="p-4">{allCompanies().find((c) => c.id === o.companyId)?.name ?? '—'}</td>
                    <td className="p-4">{o.supplierName}</td>
                    <td className="p-4 text-text-secondary">{formatDate(o.createdAt)}</td>
                    <td className="p-4 text-right">
                      <PriceDisplay amount={o.total} size="sm" />
                    </td>
                    <td className="p-4">
                      <StatusBadge domain="order" status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards (section 43 - tables become cards rather than horizontal scroll) */}
          <div className="flex flex-col gap-3 sm:hidden">
            {orders.map((o) => (
              <div key={o.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{o.reference}</span>
                  <PriceDisplay amount={o.total} size="sm" />
                </div>
                <p className="text-caption mt-1">
                  {allCompanies().find((c) => c.id === o.companyId)?.name ?? '—'} &rarr; {o.supplierName}
                </p>
                <p className="text-metadata">{formatDate(o.createdAt)}</p>
                <div className="mt-2">
                  <StatusBadge domain="order" status={o.status} />
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-caption text-text-secondary">
                Page {page} of {totalPages} &middot; {result?.total} total
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
