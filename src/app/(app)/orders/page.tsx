'use client';

import { useRouter } from 'next/navigation';
import { Package } from 'lucide-react';
import { useActiveCompany, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ordersService } from '@/services/orders.service';
import { catalogService } from '@/services/catalog.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { Order } from '@/types/orders';
import type { SupplierProfile } from '@/types/catalog';

export default function OrdersPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();

  if (workspace === 'supplier') {
    if (!company) return null;
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;
    return <SupplierOrdersList supplier={supplier} />;
  }

  return <BuyerOrdersList />;
}

function BuyerOrdersList() {
  const router = useRouter();
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data: orders } = useAsyncData<Order[]>(companyId, () => ordersService.listOrders(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Orders</h1>
        <p className="text-body text-text-secondary">Every order placed by {company?.name}.</p>
      </div>

      {orders === null ? (
        <SkeletonTable rows={5} columns={5} />
      ) : orders.length === 0 ? (
        <EmptyState icon={Package} title="No orders yet" description="Your company's orders will appear here once you check out from the catalog." />
      ) : (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-table">
              <thead>
                <tr className="text-metadata">
                  <th className="p-4 text-left">Order</th>
                  <th className="p-4 text-left">Supplier</th>
                  <th className="p-4 text-left">Date</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-left">Payment</th>
                  <th className="p-4 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="cursor-pointer border-t border-border hover:bg-neutral-bg" onClick={() => router.push(`/orders/${o.id}`)}>
                    <td className="p-4 font-medium">{o.reference}</td>
                    <td className="p-4">{o.supplierName}</td>
                    <td className="p-4 text-text-secondary">{formatDate(o.createdAt)}</td>
                    <td className="p-4 text-right">
                      <PriceDisplay amount={o.total} size="sm" />
                    </td>
                    <td className="p-4">
                      <StatusBadge domain="payment" status={o.paymentStatus} />
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
              <div
                key={o.id}
                className="cursor-pointer rounded-lg border border-border bg-surface p-4"
                onClick={() => router.push(`/orders/${o.id}`)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{o.reference}</span>
                  <PriceDisplay amount={o.total} size="sm" />
                </div>
                <p className="text-caption mt-1">{o.supplierName} · {formatDate(o.createdAt)}</p>
                <div className="mt-2 flex gap-2">
                  <StatusBadge domain="payment" status={o.paymentStatus} />
                  <StatusBadge domain="order" status={o.status} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SupplierOrdersList({ supplier }: { supplier: SupplierProfile }) {
  const router = useRouter();
  const { data: orders } = useAsyncData<Order[]>(supplier.id, () => ordersService.listOrdersForSupplier(supplier.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Orders</h1>
        <p className="text-body text-text-secondary">Every order placed with {supplier.name}.</p>
      </div>

      {orders === null ? (
        <SkeletonTable rows={5} columns={5} />
      ) : orders.length === 0 ? (
        <EmptyState icon={Package} title="No orders yet" description="Orders buyers place with you will appear here." />
      ) : (
        <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
          <table className="w-full text-table">
            <thead>
              <tr className="text-metadata">
                <th className="p-4 text-left">Order</th>
                <th className="p-4 text-left">Buyer</th>
                <th className="p-4 text-left">Date</th>
                <th className="p-4 text-right">Amount</th>
                <th className="p-4 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer border-t border-border hover:bg-neutral-bg" onClick={() => router.push(`/orders/${o.id}`)}>
                  <td className="p-4 font-medium">{o.reference}</td>
                  <td className="p-4">{allCompanies().find((c) => c.id === o.companyId)?.name ?? '—'}</td>
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

      {orders && orders.length > 0 && (
        <div className="flex flex-col gap-3 sm:hidden">
          {orders.map((o) => (
            <div key={o.id} className="cursor-pointer rounded-lg border border-border bg-surface p-4" onClick={() => router.push(`/orders/${o.id}`)}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{o.reference}</span>
                <PriceDisplay amount={o.total} size="sm" />
              </div>
              <p className="text-caption mt-1">
                {allCompanies().find((c) => c.id === o.companyId)?.name ?? '—'} · {formatDate(o.createdAt)}
              </p>
              <div className="mt-2">
                <StatusBadge domain="order" status={o.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
