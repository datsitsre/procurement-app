'use client';

import { useRouter } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { invoicesService } from '@/services/invoices.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { Invoice } from '@/types/orders';

export default function InvoicesPage() {
  const router = useRouter();
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const { data: invoices } = useAsyncData<Invoice[]>(companyId, () => invoicesService.listInvoices(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Invoices</h1>
        <p className="text-body text-text-secondary">Supplier invoices and their payment status.</p>
      </div>

      {invoices === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : invoices.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" description="Supplier invoices will appear here once orders are placed." />
      ) : (
        <div className="flex flex-col gap-3">
          {invoices.map((inv) => (
            <div
              key={inv.id}
              className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-surface p-4 hover:bg-neutral-bg sm:flex-row sm:items-center sm:justify-between"
              onClick={() => router.push(`/invoices/${inv.id}`)}
            >
              <div>
                <p className="text-sm font-semibold">{inv.reference}</p>
                <p className="text-caption">{inv.supplierName} · due {formatDate(inv.dueDate)}</p>
              </div>
              <div className="flex items-center gap-3">
                <PriceDisplay amount={inv.total} size="sm" />
                <StatusBadge domain="invoice" status={inv.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
