'use client';

import { Wallet } from 'lucide-react';
import { useActiveCompany, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { paymentService } from '@/services/payment.service';
import { catalogService } from '@/services/catalog.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { PaymentMethodConfigs } from '@/config/payment-methods';
import { formatDateTime } from '@/utils/format';
import type { Payment } from '@/types/orders';
import type { SupplierProfile } from '@/types/catalog';

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
  const { data: payments } = useAsyncData<Payment[]>(companyId, () => paymentService.listPayments(companyId!));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Payments</h1>
        <p className="text-body text-text-secondary">Every payment {company?.name} has made through the platform.</p>
      </div>

      {payments === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : payments.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payments yet"
          description="Payments you make against purchase orders and invoices will appear here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {payments.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">{PaymentMethodConfigs[p.method].label}</p>
                <p className="text-caption">
                  {p.reference} · {formatDateTime(p.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <PriceDisplay amount={p.amount} size="sm" />
                <StatusBadge domain="payment" status={p.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierPaymentsList({ supplier }: { supplier: SupplierProfile }) {
  const { data: payments } = useAsyncData<Payment[]>(supplier.id, () => paymentService.listPaymentsForSupplier(supplier.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Payments</h1>
        <p className="text-body text-text-secondary">Every payment {supplier.name} has received through the platform.</p>
      </div>

      {payments === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : payments.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments yet" description="Payments buyers make against your orders and invoices will appear here." />
      ) : (
        <div className="flex flex-col gap-3">
          {payments.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">{allCompanies().find((c) => c.id === p.companyId)?.name ?? 'Buyer'}</p>
                <p className="text-caption">
                  {PaymentMethodConfigs[p.method].label} · {p.reference} · {formatDateTime(p.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <PriceDisplay amount={p.amount} size="sm" />
                <StatusBadge domain="payment" status={p.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
