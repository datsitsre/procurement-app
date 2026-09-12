'use client';

import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { RFQ } from '@/types/procurement';

export default function RfqsPage() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data: rfqs } = useAsyncData<RFQ[]>(companyId, () => procurementService.listRfqs(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1">RFQs</h1>
          <p className="text-body text-text-secondary">Requests for quotation sent to your suppliers.</p>
        </div>
        <Link href="/rfqs/create">
          <Button>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create RFQ
          </Button>
        </Link>
      </div>

      {rfqs === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rfqs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No RFQs yet"
          description="You haven't requested any quotations yet."
          action={
            <Link href="/rfqs/create" className="text-sm font-medium text-accent hover:underline">
              Create your first RFQ
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rfqs.map((rfq) => {
            const responses = rfq.suppliers.filter((s) => s.status === 'QUOTED').length;
            return (
              <Link key={rfq.id} href={`/rfqs/${rfq.id}`} className="block rounded-lg border border-border bg-surface p-4 hover:border-accent">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold">{rfq.reference}</p>
                    <p className="text-caption">
                      {rfq.items.map((i) => `${i.productName} × ${i.quantity}`).join(', ')}
                    </p>
                  </div>
                  <StatusBadge domain="rfq" status={rfq.status} />
                </div>
                <p className="mt-2 text-caption">
                  {rfq.suppliers.length} supplier{rfq.suppliers.length === 1 ? '' : 's'} invited · {responses} response{responses === 1 ? '' : 's'} · due {formatDate(rfq.requiredDeliveryDate)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
