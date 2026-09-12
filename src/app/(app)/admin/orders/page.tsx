'use client';

import { Package } from 'lucide-react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { ordersService } from '@/services/orders.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { Order } from '@/types/orders';

export default function AdminOrdersPage() {
  return (
    <AdminGuard>
      <OrdersOverview />
    </AdminGuard>
  );
}

function OrdersOverview() {
  const { data: orders } = useAsyncData<Order[]>('admin-orders-list', () => ordersService.listAllOrders());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Orders</h1>
        <p className="text-body text-text-secondary">Every order placed across the platform.</p>
      </div>

      {orders === null ? (
        <SkeletonTable rows={5} columns={6} />
      ) : orders.length === 0 ? (
        <EmptyState icon={Package} title="No orders yet" description="Orders placed across the platform will appear here." />
      ) : (
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
      )}
    </div>
  );
}
