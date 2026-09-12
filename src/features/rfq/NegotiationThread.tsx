'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { procurementService } from '@/services/procurement.service';
import { useAsyncData } from '@/hooks/useAsyncData';
import { Button } from '@/components/ui/Button';
import { formatDateTime } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { NegotiationMessage } from '@/types/procurement';

export interface NegotiationThreadProps {
  rfqId: string;
  quoteId: string;
}

/**
 * Structured negotiation history (section 20) - append-only: there is no edit/delete action
 * anywhere in this component or the service behind it, "Accepted" and other past messages
 * can never be altered after the fact. Supplier replies are a mock stand-in (see
 * procurement.service.ts's sendNegotiationMessage) since there's no supplier portal yet.
 */
export function NegotiationThread({ rfqId, quoteId }: NegotiationThreadProps) {
  const key = `${rfqId}:${quoteId}`;
  const { data: messages, reload } = useAsyncData<NegotiationMessage[]>(key, () =>
    procurementService.listNegotiationMessages(rfqId, quoteId),
  );
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!draft.trim()) return;
    setSending(true);
    await procurementService.sendNegotiationMessage(rfqId, quoteId, draft.trim());
    setDraft('');
    setSending(false);
    reload();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {(messages ?? []).length === 0 ? (
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
              {m.proposedPrice && <p className="mt-1 text-xs opacity-80">Proposed: ₵{m.proposedPrice}/unit</p>}
              <p className="mt-1 text-[11px] opacity-70">{formatDateTime(m.sentAt)}</p>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Write a message…"
          className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button size="sm" onClick={handleSend} loading={sending} disabled={!draft.trim()}>
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
