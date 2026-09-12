'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { disputesService } from '@/services/disputes.service';
import { catalogService } from '@/services/catalog.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { Dispute } from '@/types/orders';

export default function AdminDisputesPage() {
  return (
    <AdminGuard>
      <DisputesQueue />
    </AdminGuard>
  );
}

function DisputesQueue() {
  const { session } = useAuth();
  const membership = useActiveMembership();
  const { data: disputes, reload } = useAsyncData<Dispute[]>('admin-disputes-list', () => disputesService.listAllDisputes());
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(disputeId: string, decision: 'RESOLVED_REFUND' | 'RESOLVED_REJECTED') {
    if (!session || !membership) return;
    setError(null);
    setSubmitting(true);
    const result = await disputesService.resolveDispute(disputeId, decision, note, membership.role, {
      id: session.user.id,
      name: session.user.name,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setResolvingId(null);
    setNote('');
    reload();
  }

  const open = disputes?.filter((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW' || d.status === 'AWAITING_EVIDENCE') ?? [];
  const closed = disputes?.filter((d) => d.status.startsWith('RESOLVED') || d.status === 'CLOSED') ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Disputes</h1>
        <p className="text-body text-text-secondary">Issues buyers have reported against their orders.</p>
      </div>

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      {disputes === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : disputes.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No disputes" description="Issues buyers report against their orders will appear here." />
      ) : (
        <>
          {open.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-h3">Open</p>
              {open.map((d) => {
                const buyer = allCompanies().find((c) => c.id === d.companyId)?.name ?? 'Buyer';
                const supplier = catalogService.getSupplierById(d.supplierId)?.name ?? 'Supplier';
                return (
                  <div key={d.id} className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-bg p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{d.reason}</p>
                        <p className="text-caption">
                          {d.orderReference} · {buyer} vs {supplier} · reported {formatDate(d.createdAt)}
                        </p>
                        <p className="text-caption mt-1">{d.description}</p>
                      </div>
                      <StatusBadge domain="dispute" status={d.status} />
                    </div>

                    {resolvingId === d.id ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Resolution note (shown to the buyer)"
                          className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setResolvingId(null)} disabled={submitting}>
                            Cancel
                          </Button>
                          <Button size="sm" variant="outline" loading={submitting} disabled={!note.trim()} onClick={() => resolve(d.id, 'RESOLVED_REJECTED')}>
                            Reject claim
                          </Button>
                          <Button size="sm" loading={submitting} disabled={!note.trim()} onClick={() => resolve(d.id, 'RESOLVED_REFUND')}>
                            Approve refund
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" onClick={() => setResolvingId(d.id)}>
                        Resolve
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {closed.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-h3">Resolved</p>
              {closed.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
                  <div>
                    <p className="text-sm font-semibold">{d.reason}</p>
                    <p className="text-caption">
                      {d.orderReference} · {d.resolutionNote}
                    </p>
                  </div>
                  <StatusBadge domain="dispute" status={d.status} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
