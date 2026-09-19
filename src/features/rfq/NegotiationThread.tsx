'use client';

import { useState } from 'react';
import { Send, Tag } from 'lucide-react';
import { procurementService } from '@/services/procurement.service';
import { useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SkeletonText } from '@/components/ui/Skeleton';
import { formatDateTime } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { NegotiationMessage } from '@/types/procurement';

export interface NegotiationThreadProps {
  rfqId: string;
  quoteId: string;
}

/**
 * Structured negotiation history (section 20/13) - append-only: there is no edit/delete action
 * anywhere in this component or the service behind it, "Accepted" and other past messages
 * can never be altered after the fact. Mounted on both sides of the conversation - the buyer's
 * RFQ detail page (rfqs/[id]/page.tsx) and the supplier's own submitted-quote view
 * (SupplierRfqResponse.tsx) - so a reply from either one lands in the same thread; which side is
 * actually allowed to post is enforced server-side (see the negotiations route), never by which
 * page happens to render this component.
 *
 * `sendNegotiationMessage`/`NegotiationMessage` already carry `proposedPrice`/`proposedQuantity`
 * (real fields, present in the service interface and type since this thread was first built) -
 * this component previously only ever sent/rendered the plain-text `message`, never exposing
 * the counter-offer fields at all. Wiring them in surfaces an existing backend capability rather
 * than inventing a new one.
 */
// Polled while the thread is open, not just fetched once, so a reply from the other side (who
// has no way to push this page an update) appears on its own instead of requiring the viewer to
// close and reopen the thread, or reload the page, to find out.
const POLL_INTERVAL_MS = 5_000;

export function NegotiationThread({ rfqId, quoteId }: NegotiationThreadProps) {
  const membership = useActiveMembership();
  const key = `${rfqId}:${quoteId}`;
  const { data: messages, loading, error, reload } = useAsyncData<NegotiationMessage[]>(
    key,
    () => procurementService.listNegotiationMessages(rfqId, quoteId),
    { pollIntervalMs: POLL_INTERVAL_MS },
  );
  const [draft, setDraft] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  const [proposedPrice, setProposedPrice] = useState('');
  const [proposedQuantity, setProposedQuantity] = useState('');
  const [sending, setSending] = useState(false);

  const offerMessages = (messages ?? []).filter((m) => m.proposedPrice !== undefined || m.proposedQuantity !== undefined);
  const currentOffer = offerMessages[offerMessages.length - 1];
  const previousOffer = offerMessages.length > 1 ? offerMessages[offerMessages.length - 2] : undefined;

  async function handleSend() {
    if (!draft.trim() || !membership) return;
    setSending(true);
    await procurementService.sendNegotiationMessage(
      rfqId,
      quoteId,
      draft.trim(),
      membership.role,
      proposedPrice ? Number(proposedPrice) : undefined,
      proposedQuantity ? Number(proposedQuantity) : undefined,
    );
    setDraft('');
    setProposedPrice('');
    setProposedQuantity('');
    setOfferOpen(false);
    setSending(false);
    reload();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      {(currentOffer || previousOffer) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {previousOffer && <OfferSummary label="Previous offer" message={previousOffer} muted />}
          {currentOffer && <OfferSummary label="Current offer" message={currentOffer} />}
        </div>
      )}

      <div aria-live="polite" className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {loading ? (
          <SkeletonText lines={3} />
        ) : error ? (
          <p className="text-sm text-danger">Couldn&rsquo;t load this conversation. Try reopening it.</p>
        ) : (messages ?? []).length === 0 ? (
          <p className="text-caption">No messages yet - start the conversation below.</p>
        ) : (
          messages!.map((m) => (
            <div
              key={m.id}
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                m.senderRole === 'BUYER' ? 'self-end bg-accent text-accent-foreground' : 'self-start bg-neutral-bg text-text-primary',
              )}
            >
              <p className="text-xs font-semibold opacity-80">{m.senderName}</p>
              <p>{m.message}</p>
              {(m.proposedPrice !== undefined || m.proposedQuantity !== undefined) && (
                <p className="mt-1 flex items-center gap-1 text-xs opacity-80">
                  <Tag className="h-3 w-3" aria-hidden="true" />
                  {m.proposedPrice !== undefined && `₵${m.proposedPrice}/unit`}
                  {m.proposedPrice !== undefined && m.proposedQuantity !== undefined && ' · '}
                  {m.proposedQuantity !== undefined && `qty ${m.proposedQuantity}`}
                </p>
              )}
              <p className="mt-1 text-[11px] opacity-70">{formatDateTime(m.sentAt)}</p>
            </div>
          ))
        )}
      </div>

      {offerOpen && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-neutral-bg/40 p-2">
          <Input
            label="Proposed price/unit"
            type="number"
            min={0}
            value={proposedPrice}
            onChange={(e) => setProposedPrice(e.target.value)}
            placeholder="Optional"
          />
          <Input
            label="Proposed quantity"
            type="number"
            min={1}
            value={proposedQuantity}
            onChange={(e) => setProposedQuantity(e.target.value)}
            placeholder="Optional"
          />
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Write a message…"
          aria-label="Message"
          className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={offerOpen}
          onClick={() => setOfferOpen((v) => !v)}
        >
          <Tag className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button size="sm" onClick={handleSend} loading={sending} disabled={!draft.trim()}>
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function OfferSummary({ label, message, muted }: { label: string; message: NegotiationMessage; muted?: boolean }) {
  return (
    <div className={cn('rounded-md border border-border p-3', muted ? 'bg-surface opacity-70' : 'bg-info-bg border-info-border')}>
      <p className="text-metadata">{label}</p>
      <p className="text-sm font-semibold">
        {message.proposedPrice !== undefined ? `₵${message.proposedPrice}/unit` : '—'}
        {message.proposedQuantity !== undefined && ` · qty ${message.proposedQuantity}`}
      </p>
      <p className="text-caption">
        {message.senderName} · {formatDateTime(message.sentAt)}
      </p>
    </div>
  );
}
