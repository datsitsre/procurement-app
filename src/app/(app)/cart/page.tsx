'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useCart, type CartLine } from '@/hooks/useCart';
import { useActiveCompany } from '@/hooks/useAuth';
import { catalogService } from '@/services/catalog.service';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { CurrencyCode } from '@/types/common';

/** Flat placeholder rates - a real tax engine (per-country VAT rules, section 55) and a real
 *  delivery-fee calculation (by weight/distance/warehouse) are future work; these keep the
 *  cart's math honest about what it is: an illustrative estimate, not a quote. */
const VAT_RATE = 0.125;
const FLAT_DELIVERY_FEE = 2000;

export default function CartPage() {
  const { loading, lines, subtotal, setQuantity, removeItem } = useCart();
  const company = useActiveCompany();
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  const tax = Math.round(subtotal * VAT_RATE);
  const deliveryFee = lines.length > 0 ? FLAT_DELIVERY_FEE : 0;
  const total = subtotal + tax + deliveryFee;

  async function handleChange(productId: string, next: number) {
    setMessage(null);
    setPendingId(productId);
    const err = await setQuantity(productId, Math.max(0, next));
    setPendingId(null);
    if (err) setMessage(err.message);
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1">Cart</h1>

      {message && (
        <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {groupedBySupplier.map(({ supplierId, supplier, lines: supplierLines }) => (
            <div key={supplierId} className="rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">
                {supplier?.name ?? 'Supplier'}
              </div>
              <ul className="divide-y divide-border">
                {supplierLines.map(({ item, product, lineTotal, savingsPerUnit }) => (
                  <li key={item.id} className="flex items-center gap-4 px-4 py-4">
                    {/* eslint-disable-next-line @next/next/no-img-element -- demo product photo */}
                    <img src={product.images[0]} alt={product.name} className="h-16 w-16 rounded-md object-cover" />
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

                    <div className="w-24 text-right text-sm font-semibold">
                      <PriceDisplay amount={lineTotal} currency={product.currency} size="sm" />
                    </div>

                    <button
                      type="button"
                      aria-label={`Remove ${product.name}`}
                      onClick={() => removeItem(product.id)}
                      className="text-text-tertiary hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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

          <Link
            href="/purchase-requests"
            className="mt-4 flex w-full items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            Request approval
          </Link>
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
