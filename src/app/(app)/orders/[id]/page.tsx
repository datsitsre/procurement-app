'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, MapPin, Truck, TriangleAlert } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { disputesService } from '@/services/disputes.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { formatDate, formatDateTime } from '@/utils/format';
import { hasPermission, Permission, type Role } from '@/config/rbac';
import type { Delivery, Dispute, Invoice, Order, OrderTimelineEvent, Shipment } from '@/types/orders';

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const { data: order, loading, error, reload: reloadOrder } = useAsyncData<Order>(params.id, () => ordersService.getOrder(params.id));
  const { data: timeline, reload: reloadTimeline } = useAsyncData<OrderTimelineEvent[]>(params.id, () => ordersService.listTimeline(params.id));
  const { data: shipments, reload: reloadShipments } = useAsyncData<Shipment[]>(params.id, () => ordersService.listShipments(params.id));
  const { data: deliveries, reload: reloadDeliveries } = useAsyncData<Delivery[]>(params.id, () => ordersService.listDeliveries(params.id));
  const { data: invoice } = useAsyncData<Invoice | null>(params.id, () => invoicesService.getInvoiceForOrder(params.id));
  const { data: dispute, reload: reloadDispute } = useAsyncData<Dispute | null>(params.id, () => disputesService.getDisputeForOrder(params.id));

  function reloadAll() {
    reloadOrder();
    reloadTimeline();
    reloadShipments();
    reloadDeliveries();
  }

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

          {workspace === 'buyer' && company && (order.status === 'DELIVERED' || order.status === 'PARTIALLY_DELIVERED') && (
            <DisputePanel order={order} companyId={company.id} dispute={dispute ?? null} onChanged={reloadDispute} />
          )}
        </div>

        <div className="flex flex-col gap-6">
          {workspace === 'supplier' && membership && hasPermission(membership.role, Permission.ORDERS_FULFILL) && (
            <FulfillmentPanel order={order} shipment={(shipments ?? [])[0]} callerRole={membership.role} onChanged={reloadAll} />
          )}

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

function FulfillmentPanel({
  order,
  shipment,
  callerRole,
  onChanged,
}: {
  order: Order;
  shipment: Shipment | undefined;
  callerRole: Role;
  onChanged: () => void;
}) {
  const [driverName, setDriverName] = useState('');
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setSubmitting(true);
    setError(null);
    const result = await action();
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error?.message ?? 'Something went wrong.');
      return;
    }
    setShowDispatchForm(false);
    onChanged();
  }

  if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="mb-3 text-h3">Fulfillment</p>

      {error && <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      {order.status === 'CONFIRMED' && (
        <Button className="w-full" loading={submitting} onClick={() => run(() => ordersService.markProcessing(order.id, callerRole))}>
          Start processing
        </Button>
      )}

      {order.status === 'PROCESSING' && !showDispatchForm && (
        <Button className="w-full" onClick={() => setShowDispatchForm(true)}>
          Dispatch order
        </Button>
      )}

      {order.status === 'PROCESSING' && showDispatchForm && (
        <div className="flex flex-col gap-3">
          <Input label="Driver name (optional)" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowDispatchForm(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button className="flex-1" loading={submitting} onClick={() => run(() => ordersService.dispatchOrder(order.id, driverName, callerRole))}>
              Confirm dispatch
            </Button>
          </div>
        </div>
      )}

      {order.status === 'SHIPPED' && (
        <Button className="w-full" loading={submitting} onClick={() => run(() => ordersService.markDelivered(order.id, callerRole))}>
          Mark delivered
        </Button>
      )}

      {shipment && <p className="mt-3 text-caption">Tracking: {shipment.trackingNumber}</p>}
    </div>
  );
}

function DisputePanel({
  order,
  companyId,
  dispute,
  onChanged,
}: {
  order: Order;
  companyId: string;
  dispute: Dispute | null;
  onChanged: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dispute) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-h3">Reported issue</p>
          <StatusBadge domain="dispute" status={dispute.status} />
        </div>
        <p className="text-sm font-medium">{dispute.reason}</p>
        <p className="text-caption mt-1">{dispute.description}</p>
        {dispute.resolutionNote && (
          <p className="mt-3 rounded-md bg-neutral-bg p-3 text-sm">
            <span className="font-medium">Resolution: </span>
            {dispute.resolutionNote}
          </p>
        )}
      </div>
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await disputesService.createDispute({
      orderId: order.id,
      orderReference: order.reference,
      companyId,
      supplierId: order.supplierId,
      reason,
      description,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setReporting(false);
    onChanged();
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      {!reporting ? (
        <Button variant="outline" className="w-full" onClick={() => setReporting(true)}>
          <TriangleAlert className="h-4 w-4" aria-hidden="true" />
          Report an issue
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-h3">Report an issue with this order</p>
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Item arrived damaged" required />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Description</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened, and what outcome are you looking for?"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setReporting(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting} disabled={!reason.trim() || !description.trim()}>
              Submit report
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
