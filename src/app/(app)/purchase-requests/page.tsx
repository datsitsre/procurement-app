'use client';

import Link from 'next/link';
import { ClipboardCheck, Repeat } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { RoleLabels, type Role } from '@/config/rbac';
import { formatDate } from '@/utils/format';
import type { PurchaseRequest } from '@/types/procurement';

export default function PurchaseRequestsPage() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data: requests } = useAsyncData<PurchaseRequest[]>(companyId, () => procurementService.listPurchaseRequests(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1">Purchase requests</h1>
          <p className="text-body text-text-secondary">Carts submitted for your company&rsquo;s approval.</p>
        </div>
        <Link href="/purchase-requests/recurring">
          <Button variant="outline">
            <Repeat className="h-4 w-4" aria-hidden="true" />
            Recurring purchases
          </Button>
        </Link>
      </div>

      {requests === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : requests.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No purchase requests yet" description="Submit a cart for approval from the Cart page." />
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((pr) => {
            const currentStep = pr.approvalSteps.find((s) => s.status === 'PENDING');
            return (
              <Link key={pr.id} href={`/purchase-requests/${pr.id}`} className="block rounded-lg border border-border bg-surface p-4 hover:border-accent">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold">{pr.reference}</p>
                    <p className="text-caption">{pr.reason}</p>
                  </div>
                  <StatusBadge domain="purchaseRequest" status={pr.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption">
                  <span>
                    {pr.requesterName} · {formatDate(pr.createdAt)}
                  </span>
                  <PriceDisplay amount={pr.totalAmount} size="sm" />
                </div>
                {currentStep && (
                  <p className="mt-1 text-caption">
                    Waiting on {RoleLabels[currentStep.approverRole as Role] ?? currentStep.approverRole}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
