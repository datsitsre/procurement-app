'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useCart, type CartLine } from '@/hooks/useCart';
import { useAuth, useActiveCompany, useActiveMembership, useTenantContext } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { catalogService } from '@/services/catalog.service';
import { procurementService } from '@/services/procurement.service';
import { companyService } from '@/services/company.service';
import { TemplatesPanel } from '@/features/procurement/TemplatesPanel';
import type { CostCenter } from '@/types/company';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { VAT_RATE, FLAT_DELIVERY_FEE, calculateTax } from '@/utils/pricing';
import { cn } from '@/utils/cn';
import type { CurrencyCode } from '@/types/common';
import type { PurchaseRequestItem } from '@/types/procurement';

export default function CartPage() {
  const router = useRouter();
  const { session } = useAuth();
  const { loading, lines, subtotal, setQuantity, removeItem, clear, refresh } = useCart();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const tenant = useTenantContext();
  const companyId = company?.id ?? null;
  const { data: costCenters } = useAsyncData<CostCenter[]>(companyId, () => companyService.listCostCenters(companyId!));
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [costCenterId, setCostCenterId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showReasonPrompt, setShowReasonPrompt] = useState(false);

  const groupedBySupplier = useMemo(() => {
    const groups = new Map<string, CartLine[]>();
    for (const line of lines) {
      const key = line.product.supplierId;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return Array.from(groups.entries()).map(([supplierId, supplierLines]) => ({
      supplierId,
      supplier: catalogService.getSupplierById(supplierId),
      lines: supplierLines,
    }));
  }, [lines]);

  const tax = calculateTax(subtotal);
  const deliveryFee = lines.length > 0 ? FLAT_DELIVERY_FEE : 0;
  const total = subtotal + tax + deliveryFee;

  async function handleTemplateApplied(warnings: string[]) {
    await refresh();
    if (warnings.length > 0) toast.show(warnings.join(' '), 'info');
  }

  async function handleChange(productId: string, next: number) {
    setPendingId(productId);
    const err = await setQuantity(productId, Math.max(0, next));
    setPendingId(null);
    if (err) toast.show(err.message, 'error');
  }

  async function handleSubmitRequest() {
    if (!company || !session || !membership) return;
    if (!reason.trim()) {
      setReasonError('Add a reason for this purchase before submitting.');
      return;
    }
    setReasonError(null);
    setSubmitting(true);

    const items: PurchaseRequestItem[] = lines.map((l) => ({
      id: l.item.id,
      productId: l.product.id,
      productName: l.product.name,
      supplierId: l.product.supplierId,
      supplierName: catalogService.getSupplierById(l.product.supplierId)?.name ?? 'Supplier',
      quantity: l.item.quantity,
      unitPrice: l.item.unitPrice,
    }));

    const result = await procurementService.createPurchaseRequest(
      {
        companyId: company.id,
        requesterUserId: session.user.id,
        requesterName: session.user.name,
        department: membership.department,
        costCenterId: costCenterId || undefined,
        items,
        reason: reason.trim(),
      },
      membership.role,
    );

    setSubmitting(false);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    await clear();
    toast.show('Purchase request submitted for approval.', 'success');
    router.push(`/purchase-requests/${result.data.id}`);
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-h1">Cart</h1>
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Add products from the catalog to build your order."
          action={
            <Link href="/catalog" className="text-sm font-medium text-accent hover:underline">
              Browse the catalog
            </Link>
          }
        />
        {company && session && membership && (
          <TemplatesPanel
            companyId={company.id}
            userId={session.user.id}
            callerRole={membership.role}
            tenant={tenant}
            onApplied={handleTemplateApplied}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1">Cart</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {groupedBySupplier.map(({ supplierId, supplier, lines: supplierLines }) => (
            <div key={supplierId} className="rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">
                {supplier?.name ?? 'Supplier'}
              </div>
              <ul className="divide-y divide-border">
                {supplierLines.map(({ item, product, lineTotal, savingsPerUnit }) => (
                  <li key={item.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex flex-1 gap-4">
                      {/* eslint-disable-next-line @next/next/no-img-element -- demo product photo */}
                      <img src={product.images[0]} alt={product.name} className="h-16 w-16 shrink-0 rounded-md object-cover" />
                      <div className="flex-1">
                        <Link href={`/product/${product.slug}`} className="text-sm font-medium hover:underline">
                          {product.name}
                        </Link>
                        <p className="text-caption">
                          <PriceDisplay amount={item.unitPrice} currency={product.currency} size="sm" /> each
                          {savingsPerUnit > 0 && <span className="text-success"> · saving {savingsPerUnit} /unit</span>}
                        </p>
                        <p className="text-metadata">MOQ {product.moq}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          disabled={pendingId === product.id}
                          onClick={() => handleChange(product.id, item.quantity - 1 < product.moq ? 0 : item.quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-neutral-bg disabled:opacity-50"
                        >
                          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          disabled={pendingId === product.id}
                          onClick={() => handleChange(product.id, item.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-neutral-bg disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="w-20 shrink-0 text-right text-sm font-semibold sm:w-24">
                        <PriceDisplay amount={lineTotal} currency={product.currency} size="sm" />
                      </div>

                      <button
                        type="button"
                        aria-label={`Remove ${product.name}`}
                        onClick={() => removeItem(product.id)}
                        className="shrink-0 text-text-tertiary hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {company && session && membership && (
            <TemplatesPanel
              companyId={company.id}
              userId={session.user.id}
              callerRole={membership.role}
              tenant={tenant}
              currentLines={lines}
              onApplied={handleTemplateApplied}
            />
          )}
        </div>

        <aside className="h-fit rounded-lg border border-border bg-surface p-5">
          <h2 className="text-h3 mb-4">Order summary</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Subtotal" amount={subtotal} currency={company?.currency} />
            <Row label={`Tax (${(VAT_RATE * 100).toFixed(1)}%, est.)`} amount={tax} currency={company?.currency} />
            <Row label="Delivery (est.)" amount={deliveryFee} currency={company?.currency} />
          </dl>
          <div className="my-3 border-t border-border" />
          <div className="flex items-center justify-between text-base font-semibold">
            <span>Total</span>
            <PriceDisplay amount={total} currency={company?.currency} size="lg" />
          </div>

          {showReasonPrompt ? (
            <div className="mt-4 flex flex-col gap-2">
              <label htmlFor="reason" className="text-sm font-medium">
                Reason for this purchase
              </label>
              <textarea
                id="reason"
                rows={3}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (reasonError) setReasonError(null);
                }}
                placeholder="e.g. Network infrastructure upgrade"
                aria-invalid={!!reasonError}
                aria-describedby={reasonError ? 'reason-error' : undefined}
                className={cn(
                  'w-full rounded-md border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  reasonError ? 'border-danger focus-visible:ring-danger' : 'border-border',
                )}
              />
              {reasonError && (
                <p id="reason-error" className="text-xs text-danger">
                  {reasonError}
                </p>
              )}
              {costCenters && costCenters.length > 0 && (
                <Select
                  label="Cost center (optional)"
                  value={costCenterId}
                  onChange={(e) => setCostCenterId(e.target.value)}
                >
                  <option value="">No cost center</option>
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} · {cc.name}
                    </option>
                  ))}
                </Select>
              )}
              <Button onClick={handleSubmitRequest} loading={submitting} className="w-full">
                Submit for approval
              </Button>
            </div>
          ) : (
            <Button onClick={() => setShowReasonPrompt(true)} className="mt-4 w-full">
              Request approval
            </Button>
          )}
          <p className="mt-2 text-caption">
            Submits this cart as a purchase request for your company&rsquo;s approval workflow.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, amount, currency }: { label: string; amount: number; currency?: CurrencyCode }) {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <dt>{label}</dt>
      <dd className="text-text-primary">
        <PriceDisplay amount={amount} currency={currency} size="sm" />
      </dd>
    </div>
  );
}
