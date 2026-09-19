'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { useActiveCompany, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { invoicesService } from '@/services/invoices.service';
import { catalogService } from '@/services/catalog.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { formatDate } from '@/utils/format';
import type { Invoice } from '@/types/orders';
import type { SupplierProfile } from '@/types/catalog';

const PAGE_SIZE = 25;

export default function InvoicesPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();

  if (workspace === 'supplier') {
    if (!company) return null;
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;
    return <SupplierInvoicesList supplier={supplier} />;
  }

  return <BuyerInvoicesList />;
}

function BuyerInvoicesList() {
  const router = useRouter();
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const [page, setPage] = useState(1);
  const { data: result, error, reload } = useAsyncData(companyId ? `${companyId}-${page}` : null, () => invoicesService.listInvoices(companyId!, page, PAGE_SIZE));
  const invoices = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Invoices</h1>
        <p className="text-body text-text-secondary">Supplier invoices and their payment status.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load invoices" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : invoices === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : invoices.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" description="Supplier invoices will appear here once orders are placed." />
      ) : (
        <>
          <InvoiceTable
            invoices={invoices}
            counterpartyLabel="Supplier"
            counterpartyName={(inv) => inv.supplierName}
            onOpen={(id) => router.push(`/invoices/${id}`)}
          />
          <Pagination page={page} totalPages={totalPages} total={result?.total ?? 0} onChange={setPage} itemLabel="invoice" />
        </>
      )}
    </div>
  );
}

function SupplierInvoicesList({ supplier }: { supplier: SupplierProfile }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data: result, error, reload } = useAsyncData(`${supplier.id}-${page}`, () => invoicesService.listInvoicesForSupplier(supplier.id, page, PAGE_SIZE));
  const invoices = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Invoices</h1>
        <p className="text-body text-text-secondary">Invoices {supplier.name} has issued to buyers.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load invoices" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : invoices === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : invoices.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" description="Invoices you issue after an order is checked out will appear here." />
      ) : (
        <>
          <InvoiceTable
            invoices={invoices}
            counterpartyLabel="Buyer"
            counterpartyName={(inv) => allCompanies().find((c) => c.id === inv.companyId)?.name ?? 'Buyer'}
            onOpen={(id) => router.push(`/invoices/${id}`)}
          />
          <Pagination page={page} totalPages={totalPages} total={result?.total ?? 0} onChange={setPage} itemLabel="invoice" />
        </>
      )}
    </div>
  );
}

/** Finance-focused list (section 17) - a real table on desktop (Invoice / counterparty / Amount
 *  / Due / Status, matching the brief's own example), cards on mobile - the same table-on-
 *  desktop/cards-on-mobile split already established for orders/purchase-requests, not a new
 *  pattern invented for this page. */
function InvoiceTable({
  invoices,
  counterpartyLabel,
  counterpartyName,
  onOpen,
}: {
  invoices: Invoice[];
  counterpartyLabel: string;
  counterpartyName: (inv: Invoice) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table className="w-full text-table">
          <thead>
            <tr className="text-metadata">
              <th className="p-4 text-left">Invoice</th>
              <th className="p-4 text-left">{counterpartyLabel}</th>
              <th className="p-4 text-right">Amount</th>
              <th className="p-4 text-left">Due</th>
              <th className="p-4 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                role="link"
                tabIndex={0}
                aria-label={`Open invoice ${inv.reference}`}
                className="cursor-pointer border-t border-border outline-none hover:bg-neutral-bg focus-visible:bg-neutral-bg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                onClick={() => onOpen(inv.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(inv.id);
                }}
              >
                <td className="p-4 font-medium">{inv.reference}</td>
                <td className="p-4">{counterpartyName(inv)}</td>
                <td className="p-4 text-right">
                  <PriceDisplay amount={inv.total} size="sm" />
                </td>
                <td className="p-4 text-text-secondary">{formatDate(inv.dueDate)}</td>
                <td className="p-4">
                  <StatusBadge domain="invoice" status={inv.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:hidden">
        {invoices.map((inv) => (
          <div
            key={inv.id}
            role="link"
            tabIndex={0}
            aria-label={`Open invoice ${inv.reference}`}
            className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-surface p-4 outline-none hover:bg-neutral-bg focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => onOpen(inv.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(inv.id);
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{inv.reference}</span>
              <PriceDisplay amount={inv.total} size="sm" />
            </div>
            <p className="text-caption">
              {counterpartyName(inv)} · due {formatDate(inv.dueDate)}
            </p>
            <StatusBadge domain="invoice" status={inv.status} />
          </div>
        ))}
      </div>
    </>
  );
}
