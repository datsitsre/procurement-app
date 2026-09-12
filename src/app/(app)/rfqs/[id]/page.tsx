'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Star, Trophy } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { procurementService } from '@/services/procurement.service';
import { catalogService } from '@/services/catalog.service';
import { NegotiationThread } from '@/features/rfq/NegotiationThread';
import { SupplierRfqResponse } from '@/features/supplier/SupplierRfqResponse';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceDisplay } from '@/components/ui/PriceDisplay';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';
import type { Quote, RFQ } from '@/types/procurement';

export default function RfqDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const workspace = useWorkspace();
  const company = useActiveCompany();
  const membership = useActiveMembership();

  const { data: rfq, loading: rfqLoading, error: rfqError } = useAsyncData<RFQ>(params.id, () => procurementService.getRfq(params.id));

  if (workspace === 'supplier') {
    if (rfqLoading) {
      return (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-6 w-32" />
          <SkeletonText lines={5} />
        </div>
      );
    }
    if (rfqError || !rfq || !company || !membership) {
      return (
        <ErrorState
          title="RFQ not found"
          description="This RFQ may have been removed, or your company was not invited to it."
          secondaryAction={{ label: 'Back to RFQs', onClick: () => router.push('/rfqs') }}
        />
      );
    }
    const supplier = catalogService.getSupplierByCompanyId(company.id);
    if (!supplier) return null;

    return (
      <div className="flex flex-col gap-6">
        <Link href="/rfqs" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to RFQs
        </Link>
        <div>
          <h1 className="text-h1">{rfq.reference}</h1>
          <p className="text-body text-text-secondary">
            Delivery to {rfq.deliveryLocation} by {formatDate(rfq.requiredDeliveryDate)}
          </p>
        </div>
        {rfq.additionalRequirements && (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm">
            <span className="font-medium">Additional requirements: </span>
            {rfq.additionalRequirements}
          </div>
        )}
        <SupplierRfqResponse rfq={rfq} supplier={supplier} callerRole={membership.role} />
      </div>
    );
  }

  return <BuyerRfqDetail rfqId={params.id} rfq={rfq} rfqLoading={rfqLoading} rfqError={!!rfqError} />;
}

function BuyerRfqDetail({
  rfqId,
  rfq,
  rfqLoading,
  rfqError,
}: {
  rfqId: string;
  rfq: RFQ | null;
  rfqLoading: boolean;
  rfqError: boolean;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const membership = useActiveMembership();
  const { data: quotes } = useAsyncData<Quote[]>(rfqId, () => procurementService.listQuotesForRfq(rfqId));

  const [openThreadQuoteId, setOpenThreadQuoteId] = useState<string | null>(null);
  const [accepting, setAcceptingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (rfqLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-6 w-32" />
        <SkeletonText lines={5} />
      </div>
    );
  }

  if (rfqError || !rfq) {
    return (
      <ErrorState
        title="RFQ not found"
        description="This RFQ may have been removed or the link is incorrect."
        secondaryAction={{ label: 'Back to RFQs', onClick: () => router.push('/rfqs') }}
      />
    );
  }

  const bestPrice = quotes && quotes.length > 0 ? Math.min(...quotes.map((q) => q.totalPrice)) : null;

  async function handleAccept(quote: Quote) {
    if (!rfq || !session || !membership) return;
    setMessage(null);
    setAcceptingId(quote.id);
    const result = await procurementService.acceptQuote(rfq.id, quote.id, session.user.name, membership.role);
    setAcceptingId(null);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    router.push(`/purchase-orders/${result.data.purchaseOrderId}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/rfqs" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to RFQs
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">{rfq.reference}</h1>
          <p className="text-body text-text-secondary">
            {rfq.items.map((i) => `${i.productName} × ${i.quantity}`).join(', ')} · delivery to {rfq.deliveryLocation} by {formatDate(rfq.requiredDeliveryDate)}
          </p>
        </div>
        <StatusBadge domain="rfq" status={rfq.status} />
      </div>

      {rfq.additionalRequirements && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <span className="font-medium">Additional requirements: </span>
          {rfq.additionalRequirements}
        </div>
      )}

      {message && (
        <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {message}
        </div>
      )}

      <div>
        <h2 className="text-h3 mb-3">Suppliers invited</h2>
        <div className="flex flex-wrap gap-2">
          {rfq.suppliers.map((s) => (
            <span key={s.supplierId} className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs">
              {s.supplierName} · {s.status.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-h3 mb-3">Quotes</h2>
        {!quotes ? (
          <SkeletonText lines={4} />
        ) : quotes.length === 0 ? (
          <p className="text-caption">No quotes received yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {quotes.map((quote) => {
              const supplier = catalogService.getSupplierById(quote.supplierId);
              const isBest = quote.totalPrice === bestPrice;
              return (
                <div key={quote.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{quote.supplierName}</p>
                      {supplier && (
                        <p className="flex items-center gap-1 text-caption">
                          <Star className="h-3 w-3 fill-warning text-warning" aria-hidden="true" />
                          {supplier.rating.toFixed(1)}
                        </p>
                      )}
                    </div>
                    {isBest && (
                      <span className="flex items-center gap-1 rounded-md bg-success-bg px-2 py-1 text-xs font-medium text-success">
                        <Trophy className="h-3 w-3" aria-hidden="true" />
                        Best price
                      </span>
                    )}
                  </div>

                  <PriceDisplay amount={quote.totalPrice} size="lg" />

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-text-secondary">Delivery</dt>
                    <dd>{quote.deliveryDays} day{quote.deliveryDays === 1 ? '' : 's'}</dd>
                    <dt className="text-text-secondary">Warranty</dt>
                    <dd>{quote.warrantyMonths} months</dd>
                  </dl>

                  {quote.notes && <p className="text-caption">{quote.notes}</p>}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setOpenThreadQuoteId(openThreadQuoteId === quote.id ? null : quote.id)}
                    >
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      Negotiate
                    </Button>
                    <Button size="sm" loading={accepting === quote.id} disabled={rfq.status === 'ACCEPTED'} onClick={() => handleAccept(quote)}>
                      Accept quote
                    </Button>
                  </div>

                  {openThreadQuoteId === quote.id && <NegotiationThread rfqId={rfq.id} quoteId={quote.id} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
