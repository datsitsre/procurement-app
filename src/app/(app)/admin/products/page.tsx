'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import { useAuth, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { catalogService } from '@/services/catalog.service';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import type { Product } from '@/types/catalog';

export default function AdminProductsPage() {
  return (
    <AdminGuard>
      <ModerationQueue />
    </AdminGuard>
  );
}

const moderationTone = { PUBLISHED: 'success', PENDING_REVIEW: 'warning', REJECTED: 'danger' } as const;

function ModerationQueue() {
  const { session } = useAuth();
  const membership = useActiveMembership();
  const { data: products, reload } = useAsyncData<Product[]>('admin-products-list', () => catalogService.listAllProductsForModeration());
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function decide(productId: string, decision: 'PUBLISHED' | 'REJECTED', decisionNote?: string) {
    if (!session || !membership) return;
    setError(null);
    setActingId(productId);
    const result = await catalogService.moderateProduct(productId, decision, decisionNote, membership.role, {
      id: session.user.id,
      name: session.user.name,
    });
    setActingId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setRejectingId(null);
    setNote('');
    reload();
  }

  const pending = products?.filter((p) => p.moderationStatus === 'PENDING_REVIEW') ?? [];
  const others = products?.filter((p) => p.moderationStatus !== 'PENDING_REVIEW') ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Products</h1>
        <p className="text-body text-text-secondary">Review newly submitted product listings before they reach buyers.</p>
      </div>

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      {products === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet" description="Products suppliers list will appear here for review." />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-h3">Awaiting review</p>
              {pending.map((p) => {
                const supplier = catalogService.getSupplierById(p.supplierId);
                return (
                  <div key={p.id} className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-bg p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{p.name}</p>
                        <p className="text-caption">
                          {supplier?.name ?? 'Unknown supplier'} · {p.sku}
                        </p>
                        <p className="text-caption mt-1">{p.description}</p>
                      </div>
                      <PriceDisplay amount={p.basePrice} size="sm" />
                    </div>

                    {rejectingId === p.id ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Why is this being rejected?"
                          className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setRejectingId(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" variant="danger" loading={actingId === p.id} disabled={!note.trim()} onClick={() => decide(p.id, 'REJECTED', note)}>
                            Confirm rejection
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setRejectingId(p.id)}>
                          Reject
                        </Button>
                        <Button size="sm" loading={actingId === p.id} onClick={() => decide(p.id, 'PUBLISHED')}>
                          Publish
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-h3">All products</p>
            {others.map((p) => {
              const supplier = catalogService.getSupplierById(p.supplierId);
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-caption">
                      {supplier?.name ?? 'Unknown supplier'} · {p.sku}
                    </p>
                    {p.moderationNote && <p className="text-caption mt-1">Note: {p.moderationNote}</p>}
                  </div>
                  <Badge tone={moderationTone[p.moderationStatus]}>{p.moderationStatus.replace('_', ' ')}</Badge>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
