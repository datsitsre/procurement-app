'use client';

import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { purchaseOrderService } from '@/services/purchase-order.service';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { PurchaseOrder } from '@/types/procurement';

export default function PurchaseOrdersPage() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data: orders } = useAsyncData<PurchaseOrder[]>(companyId, () => purchaseOrderService.listPurchaseOrders(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Purchase orders</h1>
        <p className="text-body text-text-secondary">Generated once a quote is accepted or a purchase request is fully approved.</p>
      </div>

      {orders === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : orders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No purchase orders yet" description="Accept a supplier's quote from an RFQ to generate your first purchase order." />
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((po) => (
            <Link key={po.id} href={`/purchase-orders/${po.id}`} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4 hover:border-accent">
              <div>
                <p className="text-sm font-semibold">{po.reference}</p>
                <p className="text-caption">
                  {po.supplierName} · {formatDate(po.createdAt)}
                </p>
              </div>
              <PriceDisplay amount={po.total} size="sm" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
