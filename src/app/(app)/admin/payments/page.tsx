'use client';

import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { paymentService } from '@/services/payment.service';
import { catalogService } from '@/services/catalog.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { PaymentMethodConfigs } from '@/config/payment-methods';
import { formatDateTime } from '@/utils/format';
import type { Page } from '@/types/common';
import type { Payment } from '@/types/orders';

const PAGE_SIZE = 25;

export default function AdminPaymentsPage() {
  return (
    <AdminGuard>
      <PaymentsOverview />
    </AdminGuard>
  );
}

function PaymentsOverview() {
  const [page, setPage] = useState(1);
  const { data: result } = useAsyncData<Page<Payment>>(`admin-payments-list-${page}`, () => paymentService.listAllPayments(page, PAGE_SIZE));
  const payments = result?.items ?? null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Payments</h1>
        <p className="text-body text-text-secondary">Every payment processed across the platform.</p>
      </div>

      {payments === null ? (
        <SkeletonTable rows={5} columns={5} />
      ) : payments.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments yet" description="Payments made across the platform will appear here." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-table">
              <thead>
                <tr className="text-metadata">
                  <th className="p-4 text-left">Buyer</th>
                  <th className="p-4 text-left">Supplier</th>
                  <th className="p-4 text-left">Method</th>
                  <th className="p-4 text-left">Date</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-4">{allCompanies().find((c) => c.id === p.companyId)?.name ?? '—'}</td>
                    <td className="p-4">{p.supplierId ? catalogService.getSupplierById(p.supplierId)?.name ?? '—' : '—'}</td>
                    <td className="p-4">{PaymentMethodConfigs[p.method].label}</td>
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-caption text-text-secondary">
                Page {page} of {totalPages} &middot; {result?.total} total
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
