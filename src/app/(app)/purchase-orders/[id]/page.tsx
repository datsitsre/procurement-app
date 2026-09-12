'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { purchaseOrderService } from '@/services/purchase-order.service';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { PurchaseOrder } from '@/types/procurement';

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const company = useActiveCompany();
  const { data: po, loading, error } = useAsyncData<PurchaseOrder>(params.id, () => purchaseOrderService.getPurchaseOrder(params.id));

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-32" />
        <SkeletonText lines={8} />
      </div>
    );
  }

  if (error || !po) {
    return (
      <ErrorState
        title="Purchase order not found"
        description="This purchase order may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to purchase orders', onClick: () => router.push('/purchase-orders') }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/purchase-orders" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to purchase orders
      </Link>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-metadata">Purchase order</p>
            <h1 className="text-h1">{po.reference}</h1>
          </div>
          <p className="text-caption">{formatDate(po.createdAt)}</p>
        </div>

        <div className="mb-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-metadata mb-1">Buyer</p>
            <p className="text-sm font-medium">{company?.name}</p>
            <p className="text-caption">{company?.addresses.find((a) => a.isDefault)?.line1}</p>
          </div>
          <div>
            <p className="text-metadata mb-1">Supplier</p>
            <p className="text-sm font-medium">{po.supplierName}</p>
          </div>
        </div>

        <div className="mb-6 overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-bg text-metadata">
                <th className="p-3 text-left">Product</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Unit price</th>
                <th className="p-3 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="p-3">{item.productName}</td>
                  <td className="p-3 text-right">{item.quantity}</td>
                  <td className="p-3 text-right">
                    <PriceDisplay amount={item.unitPrice} size="sm" />
                  </td>
                  <td className="p-3 text-right">
                    <PriceDisplay amount={item.unitPrice * item.quantity} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto flex max-w-xs flex-col gap-1.5 text-sm">
          <Row label="Subtotal" amount={po.subtotal} />
          <Row label="Tax" amount={po.tax} />
          <Row label="Delivery" amount={po.deliveryFee} />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Total</span>
            <PriceDisplay amount={po.total} size="md" />
          </div>
        </div>

        <div className="mt-6 grid gap-6 border-t border-border pt-6 sm:grid-cols-2">
          <div>
            <p className="text-metadata mb-1">Payment terms</p>
            <p className="text-sm">{po.paymentTerms}</p>
          </div>
          <div>
            <p className="text-metadata mb-1">Delivery</p>
            <p className="text-sm">{po.deliveryLocation}</p>
          </div>
          <div>
            <p className="text-metadata mb-1">Authorized by</p>
            <p className="text-sm">{po.authorizedByName}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <PriceDisplay amount={amount} size="sm" />
    </div>
  );
}
