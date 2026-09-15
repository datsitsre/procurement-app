'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Scale, X } from 'lucide-react';
import { catalogService } from '@/services/catalog.service';
import { useCart } from '@/hooks/useCart';
import { useAsyncData } from '@/hooks/useAsyncData';
import { ProductCard } from '@/features/catalog/ProductCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Category, Product } from '@/types/catalog';

const COMPARE_STORAGE_KEY = 'procurement.compare.v1';
const MAX_COMPARE = 3;

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

export default function CatalogPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setQuantity } = useCart();

  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(searchParams.get('category'));
  const [sortBy, setSortBy] = useState<'relevance' | 'priceAsc' | 'priceDesc' | 'rating'>('relevance');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Set once from the URL (e.g. "View products" on a supplier's own page) - filters the catalog
  // down to just that supplier's listings. Not exposed as its own filter control here; clearing
  // it means leaving this page and coming back without the query param.
  const supplierId = searchParams.get('supplier');
  const supplier = supplierId ? catalogService.getSupplierById(supplierId) : undefined;
  // Lazy initializer, not an effect - sessionStorage is read once on mount without a
  // synchronous setState-in-effect (the SSR pass never touches `window`).
  const [compareIds, setCompareIds] = useState<string[]>(readCompareIds);

  useEffect(() => {
    catalogService.listCategories().then((r) => r.ok && setCategories(r.data));
  }, []);

  const filterKey = JSON.stringify({ selectedCategory, search, sortBy, supplierId });
  const { data: products } = useAsyncData(filterKey, () =>
    catalogService.listProducts({ categorySlug: selectedCategory ?? undefined, search: search || undefined, sortBy, supplierId: supplierId ?? undefined }),
  );

  function persistCompare(ids: string[]) {
    setCompareIds(ids);
    window.sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(ids));
  }

  function toggleCompare(product: Product) {
    if (compareIds.includes(product.id)) {
      persistCompare(compareIds.filter((id) => id !== product.id));
      return;
    }
    if (compareIds.length >= MAX_COMPARE) {
      setMessage(`You can compare up to ${MAX_COMPARE} products at a time.`);
      return;
    }
    persistCompare([...compareIds, product.id]);
  }

  async function handleAddToCart(product: Product) {
    setMessage(null);
    setAddingId(product.id);
    const err = await setQuantity(product.id, product.moq);
    setAddingId(null);
    if (err) setMessage(err.message);
  }

  const categoryOptions = useMemo(
    () => [{ id: 'all', name: 'All categories', slug: null as string | null }, ...categories.map((c) => ({ ...c, slug: c.slug as string | null }))],
    [categories],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Catalog</h1>
        <p className="text-body text-text-secondary">Browse products from verified suppliers.</p>
      </div>

      {supplierId && (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span>
            Showing products from <span className="font-medium">{supplier?.name ?? 'this supplier'}</span>
          </span>
          <Link href="/catalog" className="flex items-center gap-1 text-text-secondary hover:text-text-primary">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </Link>
        </div>
      )}

      {message && (
        <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by name, brand, or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="relevance">Sort: relevance</option>
          <option value="priceAsc">Price: low to high</option>
          <option value="priceDesc">Price: high to low</option>
          <option value="rating">Highest rated</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {categoryOptions.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedCategory(c.slug)}
            className={
              'rounded-md border px-3 py-1.5 text-sm font-medium ' +
              (selectedCategory === c.slug
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-surface text-text-secondary hover:bg-neutral-bg')
            }
          >
            {c.name}
          </button>
        ))}
      </div>

      {products === null ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <EmptyState title="No products match" description="Try a different search term or category." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onAddToCart={handleAddToCart}
              addingToCart={addingId === product.id}
              onCompareToggle={toggleCompare}
              compareChecked={compareIds.includes(product.id)}
            />
          ))}
        </div>
      )}

      {compareIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-20 flex justify-center px-4 lg:bottom-6 lg:pl-(--sidebar-width)">
          <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Scale className="h-4 w-4" aria-hidden="true" />
              {compareIds.length} selected
            </span>
            <Button size="sm" onClick={() => router.push('/compare')}>
              Compare
            </Button>
            <Button size="sm" variant="ghost" onClick={() => persistCompare([])}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
