'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, ShieldCheck, Clock, MapPin } from 'lucide-react';
import { catalogService } from '@/services/catalog.service';
import { useCart } from '@/hooks/useCart';
import { useAsyncData } from '@/hooks/useAsyncData';
import { BulkPricingTable } from '@/features/catalog/BulkPricingTable';
import { Button } from '@/components/ui/Button';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { availableStock, resolveTierPrice, type Product } from '@/types/catalog';

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const { setQuantity: setCartQuantity } = useCart();

  const { data: product, loading, error } = useAsyncData<Product>(params.slug, () => catalogService.getProductBySlug(params.slug));
  const supplier = useMemo(() => (product ? catalogService.getSupplierById(product.supplierId) : undefined), [product]);

  const [quantity, setQuantity] = useState(1);
  // Reset the quantity input to the new product's MOQ when navigating between products -
  // adjusted during render (React's documented pattern for "resetting state when a prop
  // changes") rather than in an effect, so it never causes a stale extra render.
  const [quantityForProductId, setQuantityForProductId] = useState<string | null>(null);
  if (product && quantityForProductId !== product.id) {
    setQuantityForProductId(product.id);
    setQuantity(product.moq);
  }

  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-24" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <ErrorState
        title="Product not found"
        description="This product may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to catalog', onClick: () => router.push('/catalog') }}
      />
    );
  }

  const stock = availableStock(product);
  const belowMoq = quantity > 0 && quantity < product.moq;
  const { unitPrice } = resolveTierPrice(product, quantity);

  async function handleAddToCart() {
    if (!product) return;
    setMessage(null);
    setAdding(true);
    const err = await setCartQuantity(product.id, quantity);
    setAdding(false);
    if (err) {
      setMessage(err.message);
    } else {
      setMessage(`Added ${quantity} × ${product.name} to your cart.`);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/catalog" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to catalog
      </Link>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- demo product photo */}
          <img src={product.images[0]} alt={product.name} className="w-full rounded-lg border border-border object-cover" />
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-h1">{product.name}</h1>
            <div className="mt-1 flex items-center gap-1 text-sm text-text-secondary">
              <Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
              {product.rating.toFixed(1)} ({product.reviewCount} reviews)
            </div>
          </div>

          <p className="text-caption">
            SKU: {product.sku} · Brand: {product.brand}
          </p>

          <div className="flex items-baseline gap-3">
            <PriceDisplay amount={unitPrice} currency={product.currency} size="lg" />
            <span className="text-caption">per unit at qty {quantity}</span>
          </div>

          <p className="text-body">
            <span className="font-medium">Availability:</span> {stock > 0 ? `${stock} units` : 'Out of stock'}
          </p>

          <div className="rounded-lg border border-border p-4">
            <p className="mb-2 text-h3">Bulk pricing</p>
            <BulkPricingTable tiers={product.priceTiers} currency={product.currency} activeQuantity={quantity} />
          </div>

          {message && (
            <div role="status" className="rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-accent">
              {message}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="qty" className="text-sm font-medium">
                Quantity
              </label>
              <input
                id="qty"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-24 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
            <Button onClick={handleAddToCart} loading={adding} disabled={stock === 0 || belowMoq}>
              Add to cart
            </Button>
            <Link href={`/rfqs?product=${product.id}`} className="text-sm font-medium text-accent hover:underline">
              Add to RFQ instead
            </Link>
          </div>
          {belowMoq && (
            <p className="text-xs text-danger">
              Minimum order quantity for this product is {product.moq} units.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-h3 mb-3">Specifications</h2>
          <dl className="flex flex-col gap-2">
            {product.specifications.map((spec) => (
              <div key={spec.label} className="flex justify-between text-sm">
                <dt className="text-text-secondary">{spec.label}</dt>
                <dd className="font-medium">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-h3 mb-3">Supplier</h2>
          {supplier ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{supplier.name}</span>
                {(supplier.verification === 'VERIFIED' || supplier.verification === 'PREMIUM_VERIFIED') && (
                  <Badge tone="success">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified
                  </Badge>
                )}
              </div>
              <p className="flex items-center gap-1 text-sm text-text-secondary">
                <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
                {supplier.rating.toFixed(1)} ({supplier.reviewCount} reviews)
              </p>
              <p className="flex items-center gap-1 text-sm text-text-secondary">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Response time: &lt; {supplier.responseTimeHours} hours
              </p>
              <p className="flex items-center gap-1 text-sm text-text-secondary">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {supplier.city}, {supplier.country}
              </p>
              {/* Supplier profile pages ship in Phase 5 - nothing to link to yet. */}
            </div>
          ) : (
            <p className="text-caption">Supplier information unavailable.</p>
          )}
        </section>
      </div>
    </div>
  );
}
