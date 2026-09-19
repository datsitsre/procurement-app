'use client';

import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { useAuth, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { catalogService } from '@/services/catalog.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import type { SupplierProfile } from '@/types/catalog';

export default function AdminSuppliersPage() {
  return (
    <AdminGuard>
      <SuppliersQueue />
    </AdminGuard>
  );
}

function SuppliersQueue() {
  const { session } = useAuth();
  const membership = useActiveMembership();
  const { data: suppliers, reload } = useAsyncData<SupplierProfile[]>('admin-suppliers-list', () => catalogService.listAllSuppliers());
  const toast = useToast();
  const [actingId, setActingId] = useState<string | null>(null);

  const DECISION_LABEL: Record<'VERIFIED' | 'SUSPENDED' | 'REJECTED', string> = {
    VERIFIED: 'verified',
    SUSPENDED: 'suspended',
    REJECTED: 'rejected',
  };

  async function decide(supplierId: string, supplierName: string, decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED') {
    if (!session || !membership) return;
    setActingId(supplierId);
    const result = await catalogService.verifySupplier(supplierId, decision, membership.role, {
      id: session.user.id,
      name: session.user.name,
    });
    setActingId(null);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(`${supplierName} ${DECISION_LABEL[decision]}.`, 'success');
    reload();
  }

  const pending = suppliers?.filter((s) => s.verification === 'PENDING_VERIFICATION') ?? [];
  const others = suppliers?.filter((s) => s.verification !== 'PENDING_VERIFICATION') ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Suppliers</h1>
        <p className="text-body text-text-secondary">Verify new suppliers and manage existing ones.</p>
      </div>

      {suppliers === null ? (
        <SkeletonTable rows={5} columns={4} />
      ) : suppliers.length === 0 ? (
        <EmptyState icon={Building2} title="No suppliers yet" description="Suppliers who register will appear here for verification." />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-h3">Awaiting verification</p>
              {pending.map((s) => (
                <div key={s.id} className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-bg p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="text-caption">
                      {s.city}, {s.country} · {s.categories.join(', ') || 'No categories set'}
                    </p>
                    <p className="text-caption">{s.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'REJECTED')}>
                      Reject
                    </Button>
                    <Button size="sm" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'VERIFIED')}>
                      Verify
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-h3">All suppliers</p>
            {others.map((s) => (
              <div key={s.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{s.name}</p>
                  <p className="text-caption">
                    {s.city}, {s.country} · {s.completedOrders} orders completed · {s.rating.toFixed(1)}★
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge domain="supplierVerification" status={s.verification} />
                  {(s.verification === 'VERIFIED' || s.verification === 'PREMIUM_VERIFIED') && (
                    <Button size="sm" variant="outline" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'SUSPENDED')}>
                      Suspend
                    </Button>
                  )}
                  {s.verification === 'SUSPENDED' && (
                    <Button size="sm" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'VERIFIED')}>
                      Reinstate
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
