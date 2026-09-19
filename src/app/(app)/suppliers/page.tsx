'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, MapPin, ShieldCheck, Star } from 'lucide-react';
import { catalogService } from '@/services/catalog.service';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { SupplierProfile } from '@/types/catalog';

export default function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // The chip list is built from every verified supplier's own declared categories (a free-text
  // taxonomy suppliers set themselves, not the product Category table), fetched once and kept
  // stable while filtering so the available chips don't shrink out from under the visitor as
  // they narrow the search.
  const [allCategories, setAllCategories] = useState<string[]>([]);
  useEffect(() => {
    catalogService.listSuppliers().then((r) => {
      if (r.ok) setAllCategories([...new Set(r.data.flatMap((s) => s.categories))].sort());
    });
  }, []);

  const filterKey = JSON.stringify({ search, selectedCategory });
  const { data: suppliers, error, reload } = useAsyncData<SupplierProfile[]>(filterKey, () =>
    catalogService.listSuppliers({ category: selectedCategory ?? undefined, search: search || undefined }),
  );

  const categoryOptions = useMemo(() => ['All categories', ...allCategories], [allCategories]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Suppliers</h1>
        <p className="text-body text-text-secondary">Browse verified suppliers you can request quotes from or buy directly.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input placeholder="Search suppliers…" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <div className="flex flex-wrap gap-2">
          {categoryOptions.map((c) => {
            const isAll = c === 'All categories';
            const active = isAll ? selectedCategory === null : selectedCategory === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCategory(isAll ? null : c)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'border-accent bg-accent text-accent-foreground' : 'border-border bg-surface text-text-secondary hover:bg-neutral-bg'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <ErrorState title="Couldn't load suppliers" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : suppliers === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <EmptyState icon={Building2} title="No suppliers found" description="Try a different search or category." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => (
            <Link key={s.id} href={`/suppliers/${s.slug}`}>
              <Card className="flex h-full flex-col gap-3 p-5 hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{s.name}</p>
                  {(s.verification === 'VERIFIED' || s.verification === 'PREMIUM_VERIFIED') && (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  )}
                </div>
                <p className="flex items-center gap-1 text-caption">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {s.city}, {s.country}
                </p>
                <p className="line-clamp-2 text-caption">{s.description}</p>
                <div className="mt-auto flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
                    {s.rating.toFixed(1)} ({s.reviewCount})
                  </span>
                  <span className="text-caption">{s.completedOrders} orders completed</span>
                </div>
                {s.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.categories.slice(0, 3).map((c) => (
                      <span key={c} className="rounded-md bg-neutral-bg px-2 py-0.5 text-metadata">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
