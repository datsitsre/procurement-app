'use client';

import { FileText } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { RFQ } from '@/types/procurement';

/**
 * A real (read-only) list of this company's RFQs. Creating a new RFQ, inviting suppliers,
 * receiving quotes, and negotiating are Phase 3 work - this shows what already exists rather
 * than a blank "coming soon" page, without pretending those deeper actions work yet.
 */
export default function RfqsPage() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data: rfqs } = useAsyncData<RFQ[]>(companyId, () => procurementService.listRfqs(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">RFQs</h1>
        <p className="text-body text-text-secondary">Requests for quotation sent to your suppliers.</p>
      </div>

      {rfqs === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rfqs.length === 0 ? (
        <EmptyState icon={FileText} title="No RFQs yet" description="You haven't requested any quotations yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {rfqs.map((rfq) => {
            const responses = rfq.suppliers.filter((s) => s.status === 'QUOTED').length;
            return (
              <div key={rfq.id} className="rounded-lg border border-border bg-surface p-4">
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
