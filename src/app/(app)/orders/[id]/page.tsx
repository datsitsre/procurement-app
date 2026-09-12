'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, MapPin, Truck } from 'lucide-react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { formatDate, formatDateTime } from '@/utils/format';
import type { Delivery, Invoice, Order, OrderTimelineEvent, Shipment } from '@/types/orders';

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: order, loading, error } = useAsyncData<Order>(params.id, () => ordersService.getOrder(params.id));
  const { data: timeline } = useAsyncData<OrderTimelineEvent[]>(params.id, () => ordersService.listTimeline(params.id));
  const { data: shipments } = useAsyncData<Shipment[]>(params.id, () => ordersService.listShipments(params.id));
  const { data: deliveries } = useAsyncData<Delivery[]>(params.id, () => ordersService.listDeliveries(params.id));
  const { data: invoice } = useAsyncData<Invoice | null>(params.id, () => invoicesService.getInvoiceForOrder(params.id));

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-32" />
        <SkeletonText lines={8} />
      </div>
    );
  }

  if (error || !order) {
    return (
      <ErrorState
        title="Order not found"
        description="This order may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to orders', onClick: () => router.push('/orders') }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/orders" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">{order.reference}</h1>
          <p className="text-body text-text-secondary">
            {order.supplierName} · Placed {formatDate(order.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <StatusBadge domain="payment" status={order.paymentStatus} />
          <StatusBadge domain="order" status={order.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-5 py-3 text-sm font-semibold">Items</div>
            <ul className="divide-y divide-border">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{item.productName}</p>
                    <p className="text-caption">×{item.quantity}</p>
                  </div>
                  <PriceDisplay amount={item.unitPrice * item.quantity} size="sm" />
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1.5 border-t border-border px-5 py-3 text-sm">
              <Row label="Subtotal" amount={order.subtotal} />
              <Row label="Tax" amount={order.tax} />
              <Row label="Delivery" amount={order.deliveryFee} />
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span>
                <PriceDisplay amount={order.total} size="md" />
              </div>
            </div>
          </div>

          {deliveries && deliveries.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="mb-3 text-h3">Deliveries</p>
              <ul className="flex flex-col gap-3">
                {deliveries.map((d) => (
                  <li key={d.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {d.deliveredQty} of {d.orderedQty} delivered
                      </span>
                      <span className="text-caption">{formatDate(d.deliveredAt)}</span>
                    </div>
                    {d.notes && <p className="text-caption mt-1">{d.notes}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-4 text-h3">Tracking</p>
            <ol className="flex flex-col gap-4">
              {(timeline ?? []).map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <span className="text-sm">
                    <span className="block font-medium">{event.label}</span>
                    <span className="text-caption">{formatDateTime(event.occurredAt)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {shipments && shipments.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="mb-3 text-h3">Shipment</p>
              <ul className="flex flex-col gap-3 text-sm">
                {shipments.map((s) => (
                  <li key={s.id} className="flex items-start gap-2">
                    <Truck className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span>
                      <span className="block font-medium">{s.trackingNumber}</span>
                      <span className="text-caption block">
                        {s.status === 'PREPARING' && 'Preparing for dispatch'}
                        {s.status === 'IN_TRANSIT' && `In transit${s.driverName ? ` · ${s.driverName}` : ''}`}
                        {s.status === 'DELIVERED' && `Delivered${s.driverName ? ` by ${s.driverName}` : ''}`}
                        {s.status === 'FAILED' && 'Delivery attempt failed'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-2 text-h3">Delivery location</p>
            <p className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
              {order.deliveryLocation}
            </p>
            {order.expectedDeliveryDate && (
              <p className="text-caption mt-2">Expected by {formatDate(order.expectedDeliveryDate)}</p>
            )}
          </div>

          {invoice && (
            <Link href={`/invoices/${invoice.id}`}>
              <Button variant="outline" className="w-full">
                View invoice {invoice.reference}
              </Button>
            </Link>
          )}
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
