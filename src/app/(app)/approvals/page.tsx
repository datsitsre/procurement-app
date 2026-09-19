'use client';

import { useEffect, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useAuth, useTenantContext } from '@/hooks/useAuth';
import { procurementService } from '@/services/procurement.service';
import { Button } from '@/components/ui/Button';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatDate } from '@/utils/format';
import type { PurchaseRequest } from '@/types/procurement';

export default function ApprovalsPage() {
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const { session } = useAuth();
  const tenant = useTenantContext();
  const toast = useToast();
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, membership]);

  function load() {
    if (!company || !membership) return;
    setRequests(null);
    procurementService.listPendingApprovals(company.id, membership.role).then((r) => r.ok && setRequests(r.data));
  }

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    if (!membership) return;
    const comment = comments[id]?.trim() || undefined;
    setDecidingId(id);
    const result = await procurementService.decideStep(id, membership.role, decision, tenant, comment, session?.user.name);
    setDecidingId(null);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    setComments((c) => ({ ...c, [id]: '' }));
    toast.show(decision === 'APPROVED' ? 'Request approved.' : 'Request rejected.', 'success');
    // Re-fetch so a request that no longer has a step pending for this role drops off the list.
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Approvals" description="Purchase requests waiting on your approval." />

      {requests === null ? (
        <SkeletonText lines={4} />
      ) : requests.length === 0 ? (
        <EmptyState icon={CheckSquare} title="Nothing to approve" description="You're all caught up - new requests will appear here." />
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((pr) => (
            <div key={pr.id} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-h3">{pr.reference}</p>
                  <p className="text-caption">Requested by {pr.requesterName} · {formatDate(pr.createdAt)}</p>
                </div>
                <PriceDisplay amount={pr.totalAmount} size="lg" />
              </div>
              <p className="mt-3 text-sm">
                <span className="font-medium">Reason:</span> {pr.reason}
              </p>
              {pr.department && (
                <p className="text-sm">
                  <span className="font-medium">Department:</span> {pr.department}
                </p>
              )}
              <label className="mt-3 flex flex-col gap-1.5" htmlFor={`comment-${pr.id}`}>
                <span className="text-sm font-medium">
                  Comment <span className="text-text-tertiary font-normal">(required to reject)</span>
                </span>
                <textarea
                  id={`comment-${pr.id}`}
                  value={comments[pr.id] ?? ''}
                  onChange={(e) => setComments((c) => ({ ...c, [pr.id]: e.target.value }))}
                  placeholder="Why are you approving or rejecting this request?"
                  rows={2}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent"
                />
              </label>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="danger"
                  disabled={decidingId === pr.id || !comments[pr.id]?.trim()}
                  loading={decidingId === pr.id}
                  onClick={() => decide(pr.id, 'REJECTED')}
                >
                  Reject
                </Button>
                <Button
                  disabled={decidingId === pr.id}
                  loading={decidingId === pr.id}
                  onClick={() => decide(pr.id, 'APPROVED')}
                >
                  Approve
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
