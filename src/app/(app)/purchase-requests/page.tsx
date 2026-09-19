'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, Repeat } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { RoleLabels, type Role } from '@/config/rbac';
import { formatDate } from '@/utils/format';
import type { Page } from '@/types/common';
import type { PurchaseRequest } from '@/types/procurement';

const PAGE_SIZE = 25;

function Pager({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between">
      <p className="text-caption text-text-secondary">
        Page {page} of {totalPages} &middot; {total} total
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export default function PurchaseRequestsPage() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const [page, setPage] = useState(1);
  const { data: result, error, reload } = useAsyncData<Page<PurchaseRequest>>(companyId ? `${companyId}-${page}` : null, () =>
    procurementService.listPurchaseRequests(companyId!, page, PAGE_SIZE),
  );
  const requests = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
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

      {error ? (
        <ErrorState title="Couldn't load purchase requests" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : requests === null ? (
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
          <Pager page={page} totalPages={totalPages} total={result?.total ?? 0} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
