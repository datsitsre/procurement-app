'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SkeletonText } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { Quote, RFQ } from '@/types/procurement';
import type { SupplierProfile } from '@/types/catalog';
import type { Role } from '@/config/rbac';

export function SupplierRfqResponse({ rfq, supplier, callerRole }: { rfq: RFQ; supplier: SupplierProfile; callerRole: Role }) {
  const router = useRouter();
  const { data: quotes, reload } = useAsyncData<Quote[]>(rfq.id, () => procurementService.listQuotesForRfq(rfq.id));

  if (!quotes) {
    return <SkeletonText lines={5} />;
  }

  const myQuote = quotes.find((q) => q.supplierId === supplier.id);
  if (myQuote) {
    return <SubmittedQuote quote={myQuote} />;
  }

  return <QuoteForm rfq={rfq} supplier={supplier} callerRole={callerRole} onSubmitted={reload} onBack={() => router.push('/rfqs')} />;
}

function SubmittedQuote({ quote }: { quote: Quote }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex items-center gap-2 text-success">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <p className="text-sm font-medium">You submitted a quote on {formatDate(quote.submittedAt)}.</p>
      </div>
      <PriceDisplay amount={quote.totalPrice} size="lg" />
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-secondary">Delivery</dt>
        <dd>
          {quote.deliveryDays} day{quote.deliveryDays === 1 ? '' : 's'}
        </dd>
        <dt className="text-text-secondary">Warranty</dt>
        <dd>{quote.warrantyMonths} months</dd>
      </dl>
      {quote.notes && <p className="mt-3 text-caption">{quote.notes}</p>}
    </div>
  );
}

function QuoteForm({
  rfq,
  supplier,
  callerRole,
  onSubmitted,
  onBack,
}: {
  rfq: RFQ;
  supplier: SupplierProfile;
  callerRole: Role;
  onSubmitted: () => void;
  onBack: () => void;
}) {
  const [unitPrices, setUnitPrices] = useState<Record<string, string>>({});
  const [deliveryDays, setDeliveryDays] = useState('5');
  const [warrantyMonths, setWarrantyMonths] = useState('12');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = rfq.items.reduce((sum, item) => sum + (Number(unitPrices[item.productId]) || 0) * item.quantity, 0);
  const allPriced = rfq.items.every((item) => Number(unitPrices[item.productId]) > 0);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await procurementService.submitQuote(
      {
        rfqId: rfq.id,
        supplierId: supplier.id,
        items: rfq.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: Number(unitPrices[item.productId]) })),
        deliveryDays: Number(deliveryDays) || 1,
        warrantyMonths: Number(warrantyMonths) || 0,
        notes: notes.trim() || undefined,
      },
      callerRole,
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSubmitted();
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-h3">Submit your quote</h2>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-bg text-metadata">
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-right">Qty</th>
              <th className="p-3 text-right">Unit price</th>
            </tr>
          </thead>
          <tbody>
            {rfq.items.map((item) => (
              <tr key={item.productId} className="border-t border-border">
                <td className="p-3">{item.productName}</td>
                <td className="p-3 text-right">{item.quantity}</td>
                <td className="p-3 text-right">
                  <Input
                    type="number"
                    className="ml-auto w-28 text-right"
                    value={unitPrices[item.productId] ?? ''}
                    onChange={(e) => setUnitPrices({ ...unitPrices, [item.productId]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto text-sm font-semibold">
        Total: <PriceDisplay amount={total} size="sm" className="ml-1" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Delivery time (days)" type="number" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} />
        <Input label="Warranty (months)" type="number" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} />
      </div>
      <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button onClick={submit} loading={submitting} disabled={!allPriced}>
          Submit quote
        </Button>
      </div>
    </div>
  );
}
