'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { useActiveCompany, useActiveMembership, useTenantContext, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { invoicesService } from '@/services/invoices.service';
import { allCompanies } from '@/services/auth.service';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { PaymentMethodConfigs } from '@/config/payment-methods';
import { formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { Invoice, PaymentMethod } from '@/types/orders';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const tenant = useTenantContext();
  const { data: invoice, loading, error, reload } = useAsyncData<Invoice>(params.id, () => invoicesService.getInvoice(params.id, tenant));

  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-32" />
        <SkeletonText lines={8} />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <ErrorState
        title="Invoice not found"
        description="This invoice may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to invoices', onClick: () => router.push('/invoices') }}
      />
    );
  }

  const amountDue = invoice.total - invoice.amountPaid;
  const availableMethods: PaymentMethod[] = [
    'CARD',
    'MTN_MOMO',
    'TELECEL_CASH',
    'AIRTELTIGO_MONEY',
    'BANK_TRANSFER',
    'WALLET',
    ...(company && company.creditTerms !== 'PREPAID' ? (['CREDIT_TERMS'] as PaymentMethod[]) : []),
  ];

  async function submitPayment() {
    if (!method || !membership) return;
    setSubmitting(true);
    setPayError(null);
    const chargeDetails = method === 'CREDIT_TERMS' ? { creditAvailable: String(company?.creditAvailable ?? 0) } : details;
    const result = await invoicesService.payInvoice(params.id, method, chargeDetails, membership.role, tenant);
    setSubmitting(false);
    if (!result.ok) {
      setPayError(result.error.message);
      return;
    }
    setPaying(false);
    reload();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/invoices" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to invoices
        </Link>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Download / print
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-metadata">Invoice</p>
            <h1 className="text-h1">{invoice.reference}</h1>
            <p className="text-caption mt-1">Issued {formatDate(invoice.issuedAt)} · Due {formatDate(invoice.dueDate)}</p>
          </div>
          <StatusBadge domain="invoice" status={invoice.status} />
        </div>

        <div className="mb-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-metadata mb-1">Billed to</p>
            <p className="text-sm font-medium">{allCompanies().find((c) => c.id === invoice.companyId)?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-metadata mb-1">Supplier</p>
            <p className="text-sm font-medium">{invoice.supplierName}</p>
            {invoice.purchaseOrderReference && <p className="text-caption">{invoice.purchaseOrderReference}</p>}
          </div>
        </div>

        <div className="mb-6 overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-bg text-metadata">
                <th className="p-3 text-left">Description</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-right">Unit price</th>
                <th className="p-3 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="p-3">{item.description}</td>
                  <td className="p-3 text-right">{item.quantity}</td>
                  <td className="p-3 text-right">
                    <PriceDisplay amount={item.unitPrice} size="sm" />
                  </td>
                  <td className="p-3 text-right">
                    <PriceDisplay amount={item.unitPrice * item.quantity} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto flex max-w-xs flex-col gap-1.5 text-sm">
          <Row label="Subtotal" amount={invoice.subtotal} />
          <Row label="Tax" amount={invoice.tax} />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
            <span>Total</span>
            <PriceDisplay amount={invoice.total} size="md" />
          </div>
          {invoice.amountPaid > 0 && <Row label="Paid" amount={invoice.amountPaid} />}
          {amountDue > 0 && (
            <div className="flex items-center justify-between font-semibold text-danger">
              <span>Amount due</span>
              <PriceDisplay amount={amountDue} size="sm" className="text-danger" />
            </div>
          )}
        </div>
      </div>

      {invoice.status !== 'PAID' && workspace === 'buyer' && (
        <div className="rounded-lg border border-border bg-surface p-6 print:hidden">
          {!paying ? (
            <Button onClick={() => setPaying(true)}>Pay invoice</Button>
          ) : (
            <div className="flex flex-col gap-4">
              <h2 className="text-h3">Pay {invoice.reference}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableMethods.map((m) => {
                  const config = PaymentMethodConfigs[m];
                  const Icon = config.icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={cn(
                        'flex items-start gap-3 rounded-md border p-3 text-left text-sm',
                        method === m ? 'border-accent bg-accent/5' : 'border-border hover:bg-neutral-bg',
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                      <span>
                        <span className="block font-medium">{config.label}</span>
                        <span className="block text-caption">{config.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {method === 'CARD' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Card number" placeholder="4111 1111 1111 1111" onChange={(e) => setDetails({ ...details, cardNumber: e.target.value })} />
                  <Input label="CVV" placeholder="123" onChange={(e) => setDetails({ ...details, cvv: e.target.value })} />
                </div>
              )}
              {(method === 'MTN_MOMO' || method === 'TELECEL_CASH' || method === 'AIRTELTIGO_MONEY') && (
                <Input label="Mobile money number" placeholder="0241234567" onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
              )}
              {method === 'BANK_TRANSFER' && (
                <Input label="Bank transfer reference" placeholder="Your bank's transfer reference" onChange={(e) => setDetails({ ...details, bankReference: e.target.value })} />
              )}

              {payError && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{payError}</p>}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setPaying(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button onClick={submitPayment} disabled={!method} loading={submitting}>
                  Pay <PriceDisplay amount={amountDue} size="sm" className="text-current" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <PriceDisplay amount={amount} size="sm" />
    </div>
  );
}
