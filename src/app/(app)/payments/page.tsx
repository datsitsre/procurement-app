'use client';

import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useActiveCompany, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { paymentService } from '@/services/payment.service';
import { catalogService } from '@/services/catalog.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Pagination } from '@/components/ui/Pagination';
import { PaymentMethodConfigs } from '@/config/payment-methods';
import { formatDateTime } from '@/utils/format';
import type { Payment } from '@/types/orders';
import type { SupplierProfile } from '@/types/catalog';

const PAGE_SIZE = 25;

export default function PaymentsPage() {
  const workspace = useWorkspace();
  const company = useActiveCompany();

  if (workspace === 'supplier') {
    if (!company) return null;
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;
    return <SupplierPaymentsList supplier={supplier} />;
  }

  return <BuyerPaymentsList />;
}

function BuyerPaymentsList() {
  const company = useActiveCompany();
  const companyId = company?.id ?? null;
  const [page, setPage] = useState(1);
  const { data: result, error, reload } = useAsyncData(companyId ? `${companyId}-${page}` : null, () => paymentService.listPayments(companyId!, page, PAGE_SIZE));
  const payments = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Payments</h1>
        <p className="text-body text-text-secondary">Every payment {company?.name} has made through the platform.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load payments" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : payments === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : payments.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payments yet"
          description="Payments you make against purchase orders and invoices will appear here."
        />
      ) : (
        <>
          <PaymentTable payments={payments} counterpartyLabel="Method" counterparty={(p) => PaymentMethodConfigs[p.method].label} />
          <Pagination page={page} totalPages={totalPages} total={result?.total ?? 0} onChange={setPage} itemLabel="payment" />
        </>
      )}
    </div>
  );
}

function SupplierPaymentsList({ supplier }: { supplier: SupplierProfile }) {
  const [page, setPage] = useState(1);
  const { data: result, error, reload } = useAsyncData(`${supplier.id}-${page}`, () => paymentService.listPaymentsForSupplier(supplier.id, page, PAGE_SIZE));
  const payments = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Payments</h1>
        <p className="text-body text-text-secondary">Every payment {supplier.name} has received through the platform.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load payments" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : payments === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : payments.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments yet" description="Payments buyers make against your orders and invoices will appear here." />
      ) : (
        <>
          <PaymentTable
            payments={payments}
            counterpartyLabel="Buyer"
            counterparty={(p) => allCompanies().find((c) => c.id === p.companyId)?.name ?? 'Buyer'}
          />
          <Pagination page={page} totalPages={totalPages} total={result?.total ?? 0} onChange={setPage} itemLabel="payment" />
        </>
      )}
    </div>
  );
}

/** Finance-focused list (section 17) - a real table on desktop, cards on mobile, matching the
 *  same split already established for orders/purchase-requests/invoices. */
function PaymentTable({
  payments,
  counterpartyLabel,
  counterparty,
}: {
  payments: Payment[];
  counterpartyLabel: string;
  counterparty: (p: Payment) => string;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
        <table className="w-full text-table">
          <thead>
            <tr className="text-metadata">
              <th className="p-4 text-left">Reference</th>
              <th className="p-4 text-left">{counterpartyLabel}</th>
              <th className="p-4 text-left">Date</th>
              <th className="p-4 text-right">Amount</th>
              <th className="p-4 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="p-4 font-medium">{p.reference}</td>
                <td className="p-4">{counterparty(p)}</td>
                <td className="p-4 text-text-secondary">{formatDateTime(p.createdAt)}</td>
                <td className="p-4 text-right">
                  <PriceDisplay amount={p.amount} size="sm" />
                </td>
                <td className="p-4">
                  <StatusBadge domain="payment" status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 sm:hidden">
        {payments.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{counterparty(p)}</span>
              <PriceDisplay amount={p.amount} size="sm" />
            </div>
            <p className="text-caption">
              {p.reference} · {formatDateTime(p.createdAt)}
            </p>
            <StatusBadge domain="payment" status={p.status} />
          </div>
        ))}
      </div>
    </>
  );
}
