'use client';

import Link from 'next/link';
import { Star, ShieldCheck, Scale } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { cn } from '@/utils/cn';
import { availableStock, resolveTierPrice, type Product, type SupplierProfile } from '@/types/catalog';

export interface ProductCardProps {
  product: Product;
  supplier?: SupplierProfile;
  onAddToCart?: (product: Product) => void;
  onCompareToggle?: (product: Product) => void;
  compareChecked?: boolean;
  addingToCart?: boolean;
}

/** The B2B product card (section 11) - deliberately more than a consumer "Add to cart" tile:
 *  MOQ, bulk-pricing indicator, and a supplier verification badge are all first-class, and
 *  "Add to cart" sits alongside "Request quote" and "Compare" rather than replacing them. */
export function ProductCard({ product, supplier, onAddToCart, onCompareToggle, compareChecked, addingToCart }: ProductCardProps) {
  const stock = availableStock(product);
  const { unitPrice } = resolveTierPrice(product, product.moq);
  const hasBulkPricing = product.priceTiers.length > 1;

  return (
    <Card className="flex flex-col overflow-hidden">
      <Link href={`/product/${product.slug}`} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element -- demo product photos from Pexels */}
        <img src={product.images[0]} alt={product.name} className="h-40 w-full object-cover" />
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link href={`/product/${product.slug}`} className="hover:underline">
          <h3 className="text-sm font-semibold leading-snug">{product.name}</h3>
        </Link>
        <p className="text-caption">
          Brand: {product.brand} · SKU: {product.sku}
        </p>

        <div className="flex items-baseline gap-2">
          <PriceDisplay amount={unitPrice} currency={product.currency} size="md" />
          {hasBulkPricing && <Badge tone="info">Bulk pricing</Badge>}
        </div>

        <div className="flex items-center justify-between text-caption">
          <span>MOQ: {product.moq} units</span>
          <span className={stock > 0 ? undefined : 'text-danger'}>{stock > 0 ? `Available: ${stock}` : 'Out of stock'}</span>
        </div>

        <div className="flex items-center gap-1 text-caption">
          <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
          {product.rating.toFixed(1)} ({product.reviewCount})
        </div>

        {supplier && (
          <div className="flex items-center gap-1 text-caption text-success">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Verified supplier
          </div>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={stock === 0 || addingToCart} loading={addingToCart} onClick={() => onAddToCart?.(product)}>
              Add to cart
            </Button>
            <Link href={`/rfqs?product=${product.id}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'flex-1')}>
              Request quote
            </Link>
          </div>
          {onCompareToggle && (
            <label className="flex items-center gap-2 text-caption">
              <input
                type="checkbox"
                checked={!!compareChecked}
                onChange={() => onCompareToggle(product)}
                className="h-3.5 w-3.5 rounded border-border accent-accent"
              />
              <Scale className="h-3.5 w-3.5" aria-hidden="true" />
              Compare
            </label>
          )}
        </div>
      </div>
    </Card>
  );
}
