import type { Dispute } from '@/types/orders';

/** Fictional dispute history (section 46/49) - one still open (for the admin queue to actually
 *  have something to act on) and one already resolved (so the resolved state renders honestly
 *  too, not just an empty list waiting for a demo click). */
export const demoDisputes: Dispute[] = [
  {
    id: 'dispute-1',
    orderId: 'order-10072',
    orderReference: 'ORD-10072',
    companyId: 'company-acme-gh',
    supplierId: 'supplier-wae',
    reason: 'Item arrived damaged',
    description: 'Two of the six APC UPS units arrived with cracked casings, likely from drop damage in transit. Requesting a replacement or partial refund.',
    evidenceUrls: [],
    status: 'OPEN',
    createdAt: '2026-08-27T10:00:00Z',
  },
  {
    id: 'dispute-2',
    orderId: 'order-10050',
    orderReference: 'ORD-10050',
    companyId: 'company-acme-gh',
    supplierId: 'supplier-aie',
    reason: 'Order cancelled by supplier',
    description: 'Supplier cancelled after confirming stock was available, leaving us to source safety equipment elsewhere on short notice. Requesting a full refund.',
    evidenceUrls: [],
    status: 'RESOLVED_REFUND',
    resolutionNote: 'Confirmed with the supplier - stock was miscounted at their warehouse. Full refund issued.',
    createdAt: '2026-07-29T09:00:00Z',
    resolvedAt: '2026-07-30T14:00:00Z',
  },
];
