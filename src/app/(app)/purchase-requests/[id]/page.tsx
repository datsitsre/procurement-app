'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Circle, X } from 'lucide-react';
import { useTenantContext } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { purchaseOrderService } from '@/services/purchase-order.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { RoleLabels, type Role } from '@/config/rbac';
import { formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import { FLAT_DELIVERY_FEE, calculateTax } from '@/utils/pricing';
import type { PurchaseRequest, PurchaseOrder } from '@/types/procurement';

export default function PurchaseRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tenant = useTenantContext();
  const { data: pr, loading, error } = useAsyncData<PurchaseRequest>(params.id, () => procurementService.getPurchaseRequest(params.id, tenant));
  const posKey = pr && pr.status === 'CONVERTED_TO_PO' ? pr.id : null;
  const { data: purchaseOrders } = useAsyncData<PurchaseOrder[]>(posKey, () => purchaseOrderService.listForPurchaseRequest(params.id));

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-32" />
        <SkeletonText lines={6} />
      </div>
    );
  }

  if (error || !pr) {
    return (
      <ErrorState
        title="Purchase request not found"
        description="This request may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to purchase requests', onClick: () => router.push('/purchase-requests') }}
      />
    );
  }

  const subtotal = pr.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const tax = calculateTax(subtotal);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/purchase-requests" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to purchase requests
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">{pr.reference}</h1>
          <p className="text-body text-text-secondary">
            Requested by {pr.requesterName}
            {pr.department && ` · ${pr.department}`} · {formatDate(pr.createdAt)}
          </p>
        </div>
        <StatusBadge domain="purchaseRequest" status={pr.status} />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="text-sm">
          <span className="font-medium">Reason: </span>
          {pr.reason}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Items</div>
        <ul className="divide-y divide-border">
          {pr.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <div>
                <p className="font-medium">{item.productName}</p>
                <p className="text-caption">
                  {item.supplierName} · ×{item.quantity}
                </p>
              </div>
              <PriceDisplay amount={item.unitPrice * item.quantity} size="sm" />
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1.5 border-t border-border px-5 py-3 text-sm">
          <SummaryRow label="Subtotal" amount={subtotal} />
          <SummaryRow label="Tax (est.)" amount={tax} />
          <SummaryRow label="Delivery (est.)" amount={FLAT_DELIVERY_FEE} />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Total</span>
            <PriceDisplay amount={pr.totalAmount} size="md" />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="mb-4 text-h3">Approval</p>
        <ol className="flex flex-col gap-3">
          {pr.approvalSteps.map((step) => (
            <li key={step.id} className="flex items-center gap-3">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                  step.status === 'APPROVED' && 'bg-success text-white',
                  step.status === 'REJECTED' && 'bg-danger text-white',
                  step.status === 'PENDING' && 'bg-neutral-bg text-text-tertiary',
                )}
              >
                {step.status === 'APPROVED' ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : step.status === 'REJECTED' ? (
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Circle className="h-2 w-2 fill-current" aria-hidden="true" />
                )}
              </span>
              <span className="text-sm">
                {RoleLabels[step.approverRole as Role] ?? step.approverRole}
                {step.approverName && ` (${step.approverName})`}
              </span>
              {step.decidedAt && <span className="text-caption">· {formatDate(step.decidedAt)}</span>}
            </li>
          ))}
        </ol>
      </div>

      {purchaseOrders && purchaseOrders.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-3 text-h3">Purchase orders</p>
          <ul className="flex flex-col gap-2">
            {purchaseOrders.map((po) => (
              <li key={po.id}>
                <Link
                  href={`/purchase-orders/${po.id}`}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm hover:bg-neutral-bg"
                >
                  <span>
                    <span className="font-medium">{po.reference}</span> · {po.supplierName}
                  </span>
                  <PriceDisplay amount={po.total} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <PriceDisplay amount={amount} size="sm" />
    </div>
  );
}
