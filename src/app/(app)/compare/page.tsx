'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Star, X, Scale } from 'lucide-react';
import { catalogService } from '@/services/catalog.service';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { buttonVariants } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { availableStock, resolveTierPrice, type Product, type SupplierProfile } from '@/types/catalog';
import { cn } from '@/utils/cn';

const COMPARE_STORAGE_KEY = 'procurement.compare.v1';

function readCompareIds(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = window.sessionStorage.getItem(COMPARE_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default function ComparePage() {
  // Lazy initializer, not an effect - sessionStorage is read once on mount without a
  // synchronous setState-in-effect (the SSR pass never touches `window`).
  const [productIds, setProductIds] = useState<string[]>(readCompareIds);
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    catalogService.listSuppliers().then((r) => r.ok && setSuppliers(r.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(productIds.map((id) => catalogService.getProductById(id))).then((results) => {
      if (cancelled) return;
      setProducts(results.filter((r): r is { ok: true; data: Product } => r.ok).map((r) => r.data));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds.join(',')]);

  function remove(productId: string) {
    const next = productIds.filter((id) => id !== productId);
    setProductIds(next);
    window.sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(next));
  }

  if (products === null) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-h1">Product comparison</h1>
          <p className="text-body text-text-secondary">Compare price, stock, and delivery side by side.</p>
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Product comparison</h1>
        <p className="text-body text-text-secondary">Compare price, stock, and delivery side by side.</p>
      </div>

      {products.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="Nothing to compare yet"
          description="Select up to 3 products from the catalog to compare them here."
          action={
            <Link href="/catalog" className="text-sm font-medium text-accent hover:underline">
              Browse the catalog
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-150 border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-32 border-b border-border p-4 text-left text-metadata">&nbsp;</th>
                {products.map((p) => (
                  <th key={p.id} className="border-b border-border p-4 text-left align-top">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element -- demo product photo */}
                        <img src={p.images[0]} alt={p.name} className="mb-2 h-20 w-20 rounded-md object-cover" />
                        <Link href={`/product/${p.slug}`} className="font-semibold hover:underline">
                          {p.name}
                        </Link>
                      </div>
                      <button type="button" onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`} className="text-text-tertiary hover:text-danger">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Price">
                {products.map((p) => (
                  <td key={p.id} className="border-b border-border p-4">
                    <PriceDisplay amount={resolveTierPrice(p, p.moq).unitPrice} currency={p.currency} />
                  </td>
                ))}
              </CompareRow>
              <CompareRow label="MOQ">
                {products.map((p) => (
                  <td key={p.id} className="border-b border-border p-4">
                    {p.moq} units
                  </td>
                ))}
              </CompareRow>
              <CompareRow label="Warranty">
                {products.map((p) => (
                  <td key={p.id} className="border-b border-border p-4">
                    {p.specifications.find((s) => s.label === 'Warranty')?.value ?? '—'}
                  </td>
                ))}
              </CompareRow>
              <CompareRow label="Stock">
                {products.map((p) => (
                  <td key={p.id} className="border-b border-border p-4">
                    {availableStock(p)} units
                  </td>
                ))}
              </CompareRow>
              <CompareRow label="Supplier rating">
                {products.map((p) => {
                  const supplier = suppliers.find((s) => s.id === p.supplierId);
                  return (
                    <td key={p.id} className="border-b border-border p-4">
                      {supplier ? (
                        <span className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
                          {supplier.rating.toFixed(1)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  );
                })}
              </CompareRow>
              <CompareRow label="">
                {products.map((p) => (
                  <td key={p.id} className="p-4">
                    <Link href={`/product/${p.slug}`} className={cn(buttonVariants({ size: 'sm' }))}>
                      View product
                    </Link>
                  </td>
                ))}
              </CompareRow>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CompareRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="border-b border-border p-4 text-metadata">{label}</td>
      {children}
    </tr>
  );
}
