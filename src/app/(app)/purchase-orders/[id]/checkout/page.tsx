'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, CircleCheck, Clock } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useTenantContext } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { purchaseOrderService } from '@/services/purchase-order.service';
import { ordersService } from '@/services/orders.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PaymentMethodConfigs, CreditTermLabels } from '@/config/payment-methods';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/format';
import type { PurchaseOrder } from '@/types/procurement';
import type { Order, PaymentMethod } from '@/types/orders';

const STEPS = ['Delivery', 'Billing', 'Payment', 'Review', 'Confirmation'] as const;

export default function CheckoutPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const tenant = useTenantContext();
  const { data: po, loading, error } = useAsyncData<PurchaseOrder>(params.id, () => purchaseOrderService.getPurchaseOrder(params.id, tenant));

  const [stepIndex, setStepIndex] = useState(0);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-32" />
        <SkeletonText lines={8} />
      </div>
    );
  }

  if (error || !po || !company) {
    return (
      <ErrorState
        title="Purchase order not found"
        description="This purchase order may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to purchase orders', onClick: () => router.push('/purchase-orders') }}
      />
    );
  }

  if (po.orderId) {
    return (
      <ErrorState
        title="Already checked out"
        description="This purchase order has already been paid for and converted into an order."
        secondaryAction={{ label: 'View order', onClick: () => router.push(`/orders/${po.orderId}`) }}
      />
    );
  }

  const address = company.addresses.find((a) => a.id === addressId) ?? company.addresses.find((a) => a.isDefault) ?? company.addresses[0];
  const availableMethods: PaymentMethod[] = [
    'CARD',
    'MTN_MOMO',
    'TELECEL_CASH',
    'AIRTELTIGO_MONEY',
    'BANK_TRANSFER',
    'WALLET',
    ...(company.creditTerms !== 'PREPAID' ? (['CREDIT_TERMS'] as PaymentMethod[]) : []),
  ];

  function goNext() {
    setSubmitError(null);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function goBack() {
    setSubmitError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function placeOrderAndPay() {
    if (!method || !po || !company || !membership) return;
    setSubmitting(true);
    setSubmitError(null);

    // Payment is charged and the invoice is raised server-side, in the same request, atomically
    // with the order itself (Phase 14, Stage 8) - credit terms no longer needs the client to
    // read the company's own available credit, since the server checks its real record.
    const orderResult = await ordersService.createFromPurchaseOrder(po, method, details);
    if (!orderResult.ok) {
      setSubmitError(orderResult.error.message);
      setSubmitting(false);
      return;
    }

    setConfirmedOrder(orderResult.data);
    setSubmitting(false);
    setStepIndex(4);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link
        href={`/purchase-orders/${po.id}`}
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to purchase order
      </Link>

      <Breadcrumb
        items={[
          { label: 'Purchase orders', href: '/purchase-orders' },
          { label: po.reference, href: `/purchase-orders/${po.id}` },
          { label: 'Checkout' },
        ]}
      />

      <div>
        <h1 className="text-h1">Checkout</h1>
        <p className="text-body text-text-secondary">
          {po.reference} · {po.supplierName}
        </p>
      </div>

      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full font-semibold',
                i < stepIndex && 'bg-success text-white',
                i === stepIndex && 'bg-accent text-accent-foreground',
                i > stepIndex && 'bg-neutral-bg text-text-tertiary',
              )}
            >
              {i < stepIndex ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn(i === stepIndex ? 'font-medium text-text-primary' : 'text-text-tertiary')}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="rounded-lg border border-border bg-surface p-6">
        {stepIndex === 0 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-h3">Delivery</h2>
            <p className="text-sm text-text-secondary">Choose where this order should be delivered.</p>
            <div className="flex flex-col gap-2">
              {company.addresses.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
                    (address?.id ?? company.addresses.find((x) => x.isDefault)?.id) === a.id ? 'border-accent bg-accent/5' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="address"
                    className="mt-0.5"
                    checked={(address?.id ?? company.addresses.find((x) => x.isDefault)?.id) === a.id}
                    onChange={() => setAddressId(a.id)}
                  />
                  <span>
                    <span className="block font-medium">{a.label}</span>
                    <span className="block text-caption">
                      {a.line1}, {a.city}, {a.country}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={goNext}>Continue to billing</Button>
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-h3">Billing</h2>
            <p className="text-sm text-text-secondary">Confirm the company being billed for this order.</p>
            <div className="rounded-md border border-border p-4 text-sm">
              <p className="font-medium">{company.legalName ?? company.name}</p>
              {company.taxId && <p className="text-caption">Tax ID: {company.taxId}</p>}
              <p className="text-caption">
                {address?.line1}, {address?.city}, {address?.country}
              </p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={goBack}>
                Back
              </Button>
              <Button onClick={goNext}>Continue to payment</Button>
            </div>
          </div>
        )}

        {stepIndex === 2 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-h3">Payment</h2>
            <p className="text-sm text-text-secondary">Choose how {company.name} will pay for this order.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {availableMethods.map((m) => {
                const config = PaymentMethodConfigs[m];
                const Icon = config.icon;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={cn(
                      'flex items-start gap-3 rounded-md border p-3 text-left text-sm',
                      method === m ? 'border-accent bg-accent/5' : 'border-border hover:bg-neutral-bg',
                    )}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span>
                      <span className="block font-medium">{config.label}</span>
                      <span className="block text-caption">{config.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {method === 'CARD' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Card number" placeholder="4111 1111 1111 1111" onChange={(e) => setDetails({ ...details, cardNumber: e.target.value })} />
                <Input label="CVV" placeholder="123" onChange={(e) => setDetails({ ...details, cvv: e.target.value })} />
              </div>
            )}
            {(method === 'MTN_MOMO' || method === 'TELECEL_CASH' || method === 'AIRTELTIGO_MONEY') && (
              <Input label="Mobile money number" placeholder="0241234567" onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
            )}
            {method === 'BANK_TRANSFER' && (
              <Input label="Bank transfer reference" placeholder="Your bank's transfer reference" onChange={(e) => setDetails({ ...details, bankReference: e.target.value })} />
            )}
            {method === 'CREDIT_TERMS' && (
              <div className="rounded-md border border-border bg-neutral-bg p-4 text-sm">
                <p>
                  Payment terms: <span className="font-medium">{CreditTermLabels[company.creditTerms]}</span>
                </p>
                <p className="text-caption mt-1">
                  Available credit: <PriceDisplay amount={company.creditAvailable ?? 0} size="sm" /> of{' '}
                  <PriceDisplay amount={company.creditLimit ?? 0} size="sm" />
                </p>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={goBack}>
                Back
              </Button>
              <Button onClick={goNext} disabled={!method}>
                Review order
              </Button>
            </div>
          </div>
        )}

        {stepIndex === 3 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-h3">Review</h2>

            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-bg text-metadata">
                    <th className="p-3 text-left">Product</th>
                    <th className="p-3 text-right">Qty</th>
                    <th className="p-3 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="p-3">{item.productName}</td>
                      <td className="p-3 text-right">{item.quantity}</td>
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

            <div className="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
              <div>
                <p className="text-metadata mb-1">Deliver to</p>
                <p>{address?.label}</p>
              </div>
              <div>
                <p className="text-metadata mb-1">Payment method</p>
                <p>{method ? PaymentMethodConfigs[method].label : '—'}</p>
              </div>
            </div>

            {submitError && (
              <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{submitError}</p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={goBack} disabled={submitting}>
                Back
              </Button>
              <Button onClick={placeOrderAndPay} loading={submitting}>
                Place order &amp; pay
              </Button>
            </div>
          </div>
        )}

        {/* A real mobile money charge is asynchronous (see orders.service.ts's createFromPurchaseOrder) -
            it comes back with the order's paymentStatus still PENDING until the customer approves the
            prompt on their phone. CREDIT_TERMS is also PENDING, but deliberately so (it's a pay-later
            reservation, not a payment awaiting confirmation) - only the mobile money methods get this
            distinct "still pending" screen. */}
        {stepIndex === 4 && confirmedOrder && confirmedOrder.paymentStatus === 'PENDING' &&
          (method === 'MTN_MOMO' || method === 'TELECEL_CASH' || method === 'AIRTELTIGO_MONEY') && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Clock className="h-12 w-12 text-warning" aria-hidden="true" />
            <div>
              <h2 className="text-h2">Order placed - payment pending</h2>
              <p className="text-body text-text-secondary">
                {confirmedOrder.reference} was placed on {formatDate(confirmedOrder.createdAt)}. Approve the payment prompt on your phone to
                confirm it - we&apos;ll update this order once it goes through.
              </p>
            </div>
            <PriceDisplay amount={confirmedOrder.total} size="lg" />
            <Button onClick={() => router.push(`/orders/${confirmedOrder.id}`)}>Track your order</Button>
          </div>
        )}

        {stepIndex === 4 && confirmedOrder &&
          !(confirmedOrder.paymentStatus === 'PENDING' && (method === 'MTN_MOMO' || method === 'TELECEL_CASH' || method === 'AIRTELTIGO_MONEY')) && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CircleCheck className="h-12 w-12 text-success" aria-hidden="true" />
            <div>
              <h2 className="text-h2">Order placed</h2>
              <p className="text-body text-text-secondary">
                {confirmedOrder.reference} was placed on {formatDate(confirmedOrder.createdAt)}.
              </p>
            </div>
            <PriceDisplay amount={confirmedOrder.total} size="lg" />
            <Button onClick={() => router.push(`/orders/${confirmedOrder.id}`)}>Track your order</Button>
          </div>
        )}
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
