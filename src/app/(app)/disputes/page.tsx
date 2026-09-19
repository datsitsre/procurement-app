'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useActiveCompany, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { disputesService } from '@/services/disputes.service';
import { catalogService } from '@/services/catalog.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { Dispute } from '@/types/orders';
import type { SupplierProfile } from '@/types/catalog';

/**
 * Buyer/supplier-facing dispute list (section 16) - `disputesService.listDisputes`/
 * `listDisputesForSupplier` and their real backend routes already existed; only the platform
 * admin queue (admin/disputes) had a page to read them. Actually reporting/resolving a dispute
 * still happens on the order detail page's DisputePanel - this page is a read-only index that
 * links back there, not a second place empowered to change dispute state.
 */
export default function DisputesPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();

  if (workspace === 'supplier') {
    if (!company) return null;
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;
    return <SupplierDisputesList supplier={supplier} />;
  }

  return <BuyerDisputesList />;
}

function BuyerDisputesList() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data: disputes, error, reload } = useAsyncData<Dispute[]>(companyId, () => disputesService.listDisputes(companyId!));
  // Primes the client-side supplier-name cache (see catalog.service.ts's own note on why this
  // exists) with a single real request - a buyer landing here directly, without having
  // previously browsed /catalog or /suppliers, would otherwise see every counterparty name
  // blank, since disputes only carries `supplierId`, not a denormalized name.
  useAsyncData('disputes-supplier-cache', () => catalogService.listSuppliers());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Disputes</h1>
        <p className="text-body text-text-secondary">Issues you&rsquo;ve reported against your orders.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load disputes" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : disputes === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : disputes.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No disputes"
          description="Report an issue from an order's page if something arrives damaged, late, or incorrect."
        />
      ) : (
        <DisputeTable disputes={disputes} counterpartyLabel="Supplier" counterparty={(d) => catalogService.getSupplierById(d.supplierId)?.name ?? '—'} />
      )}
    </div>
  );
}

function SupplierDisputesList({ supplier }: { supplier: SupplierProfile }) {
  const { data: disputes, error, reload } = useAsyncData<Dispute[]>(supplier.id, () => disputesService.listDisputesForSupplier(supplier.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Disputes</h1>
        <p className="text-body text-text-secondary">Issues buyers have reported against orders fulfilled by {supplier.name}.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load disputes" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : disputes === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : disputes.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No disputes" description="Disputes buyers raise against your orders will appear here." />
      ) : (
        <DisputeTable disputes={disputes} counterpartyLabel="Buyer" counterparty={(d) => allCompanies().find((c) => c.id === d.companyId)?.name ?? 'Buyer'} />
      )}
    </div>
  );
}

/** Links back to the order that owns each dispute (section 16) - reporting/resolving state
 *  lives entirely on the order detail page's DisputePanel; this list is a read-only index over
 *  real data, not a second place that can act on a dispute. */
function DisputeTable({
  disputes,
  counterpartyLabel,
  counterparty,
}: {
  disputes: Dispute[];
  counterpartyLabel: string;
  counterparty: (d: Dispute) => string;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table className="w-full text-table">
          <thead>
            <tr className="text-metadata">
              <th className="p-4 text-left">Order</th>
              <th className="p-4 text-left">{counterpartyLabel}</th>
              <th className="p-4 text-left">Reason</th>
              <th className="p-4 text-left">Reported</th>
              <th className="p-4 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="p-4">
                  <Link href={`/orders/${d.orderId}`} className="font-medium text-accent hover:underline">
                    {d.orderReference}
                  </Link>
                </td>
                <td className="p-4">{counterparty(d)}</td>
                <td className="p-4 text-text-secondary">{d.reason}</td>
                <td className="p-4 text-text-secondary">{formatDate(d.createdAt)}</td>
                <td className="p-4">
                  <StatusBadge domain="dispute" status={d.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:hidden">
        {disputes.map((d) => (
          <Link key={d.id} href={`/orders/${d.orderId}`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 hover:bg-neutral-bg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{d.orderReference}</span>
              <StatusBadge domain="dispute" status={d.status} />
            </div>
            <p className="text-caption">
              {counterparty(d)} · {d.reason}
            </p>
            <p className="text-metadata">Reported {formatDate(d.createdAt)}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
