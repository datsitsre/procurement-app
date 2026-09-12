'use client';

import { useEffect, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useAuth, useTenantContext } from '@/hooks/useAuth';
import { procurementService } from '@/services/procurement.service';
import { Button } from '@/components/ui/Button';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { PurchaseRequest } from '@/types/procurement';

export default function ApprovalsPage() {
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const { session } = useAuth();
  const tenant = useTenantContext();
  const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setMessage(null);
    setDecidingId(id);
    const result = await procurementService.decideStep(id, membership.role, decision, tenant, undefined, session?.user.name);
    setDecidingId(null);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    // Re-fetch so a request that no longer has a step pending for this role drops off the list.
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Approvals</h1>
        <p className="text-body text-text-secondary">Purchase requests waiting on your approval.</p>
      </div>

      {message && (
        <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {message}
        </div>
      )}

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
              <div className="mt-4 flex gap-2">
                <Button
                  variant="danger"
                  disabled={decidingId === pr.id}
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
