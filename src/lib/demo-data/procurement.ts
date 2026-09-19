import type { ApprovalRule, NegotiationMessage, PurchaseRequest, Quote, RFQ } from '@/types/procurement';

/** Minimal seeded RFQ/quote/purchase-request records (section 65) - enough to demonstrate the
 *  full RFQ -> quotes -> negotiate -> accept -> PO and cart -> purchase request -> approval ->
 *  PO pipelines against real (if fictional) data. A supplier actually receiving an RFQ and
 *  submitting a quote is Phase 5 (the supplier portal doesn't exist yet) - the quotes and
 *  negotiation messages "from" suppliers here stand in for that until it does, the same way
 *  the rest of this app's mock services simulate a backend that isn't built yet. */

export const demoApprovalRules: ApprovalRule[] = [
  { id: 'rule-1', companyId: 'company-acme-gh', minAmount: 0, maxAmount: 5000, requiredApproverRoles: ['PROCUREMENT_MANAGER'] },
  { id: 'rule-2', companyId: 'company-acme-gh', minAmount: 5001, maxAmount: 50000, requiredApproverRoles: ['PROCUREMENT_MANAGER', 'FINANCE_MANAGER'] },
  { id: 'rule-3', companyId: 'company-acme-gh', minAmount: 50001, requiredApproverRoles: ['PROCUREMENT_MANAGER', 'FINANCE_MANAGER', 'OWNER'] },
];

export const demoRfqs: RFQ[] = [
  {
    id: 'rfq-10082',
    reference: 'RFQ-10082',
    companyId: 'company-acme-gh',
    createdByUserId: 'user-john-doe',
    items: [{ id: 'rfqi-1', productId: 'prod-cisco-switch', productName: 'Cisco Catalyst Switch', quantity: 50 }],
    requiredDeliveryDate: '2026-09-20T00:00:00Z',
    deliveryLocation: 'Accra',
    additionalRequirements: 'Please include rack-mount kit and a spare unit if available.',
    attachmentIds: [],
    suppliers: [
      { supplierId: 'supplier-abc', supplierName: 'ABC Technology Solutions', status: 'QUOTED' },
      { supplierId: 'supplier-wae', supplierName: 'West Africa Electronics', status: 'QUOTED' },
      { supplierId: 'supplier-prime', supplierName: 'Prime Office Supplies', status: 'INVITED' },
    ],
    status: 'NEGOTIATION',
    createdAt: '2026-09-03T09:00:00Z',
  },
  {
    id: 'rfq-10090',
    reference: 'RFQ-10090',
    companyId: 'company-acme-gh',
    createdByUserId: 'user-john-doe',
    items: [{ id: 'rfqi-2', productId: 'prod-office-desk', productName: 'Office Desk', quantity: 30 }],
    requiredDeliveryDate: '2026-09-25T00:00:00Z',
    deliveryLocation: 'Accra',
    attachmentIds: [],
    suppliers: [{ supplierId: 'supplier-prime', supplierName: 'Prime Office Supplies', status: 'INVITED' }],
    status: 'SENT',
    createdAt: '2026-09-10T09:00:00Z',
  },
];

export const demoQuotes: Quote[] = [
  {
    id: 'quote-abc-10082',
    rfqId: 'rfq-10082',
    supplierId: 'supplier-abc',
    supplierName: 'ABC Technology Solutions',
    items: [{ id: 'qi-1', productId: 'prod-cisco-switch', quantity: 50, unitPrice: 7850 }],
    totalPrice: 392500,
    deliveryDays: 2,
    warrantyMonths: 24,
    notes: 'Includes rack-mount kit as requested. Spare unit available at an extra cost.',
    submittedAt: '2026-09-04T11:00:00Z',
  },
  {
    id: 'quote-wae-10082',
    rfqId: 'rfq-10082',
    supplierId: 'supplier-wae',
    supplierName: 'West Africa Electronics',
    items: [{ id: 'qi-2', productId: 'prod-cisco-switch', quantity: 50, unitPrice: 7650 }],
    totalPrice: 382500,
    deliveryDays: 4,
    warrantyMonths: 36,
    notes: 'Best price available for this volume. Rack-mount kit included.',
    submittedAt: '2026-09-05T09:30:00Z',
  },
];

export const demoNegotiationMessages: NegotiationMessage[] = [
  {
    id: 'neg-1',
    rfqId: 'rfq-10082',
    quoteId: 'quote-wae-10082',
    senderRole: 'BUYER',
    senderName: 'John Doe',
    message: 'We can commit to 100 units if you can bring the price down further.',
    proposedQuantity: 100,
    sentAt: '2026-09-05T14:00:00Z',
  },
  {
    id: 'neg-2',
    rfqId: 'rfq-10082',
    quoteId: 'quote-wae-10082',
    senderRole: 'SUPPLIER',
    senderName: 'West Africa Electronics',
    message: 'We can offer ₵7,650 per unit for 100+ units, same delivery and warranty terms.',
    proposedPrice: 7650,
    proposedQuantity: 100,
    sentAt: '2026-09-05T16:20:00Z',
  },
];

export const demoPurchaseRequests: PurchaseRequest[] = [
  {
    id: 'pr-10082',
    reference: 'PR-10082',
    companyId: 'company-acme-gh',
    requesterUserId: 'user-john-doe',
    requesterName: 'John Doe',
    department: 'IT',
    items: [
      { id: 'pri-1', productId: 'prod-cisco-switch', productName: 'Cisco Catalyst Switch', supplierId: 'supplier-abc', supplierName: 'ABC Technology Solutions', quantity: 5, unitPrice: 8100 },
    ],
    totalAmount: 46063,
    reason: 'Network infrastructure upgrade',
    attachmentIds: [],
    approvalSteps: [{ id: 'as-1', stepOrder: 1, approverRole: 'FINANCE_MANAGER', status: 'PENDING' }],
    status: 'IN_APPROVAL',
    createdAt: '2026-09-08T10:00:00Z',
  },
  {
    id: 'pr-10075',
    reference: 'PR-10075',
    companyId: 'company-acme-gh',
    requesterUserId: 'user-michael-doe',
    requesterName: 'Michael Doe',
    department: 'Operations',
    items: [
      { id: 'pri-2', productId: 'prod-office-chair', productName: 'Office Chair', supplierId: 'supplier-prime', supplierName: 'Prime Office Supplies', quantity: 10, unitPrice: 910 },
    ],
    totalAmount: 10438,
    reason: 'Office equipment for new hires',
    attachmentIds: [],
    approvalSteps: [
      { id: 'as-2', stepOrder: 1, approverRole: 'PROCUREMENT_MANAGER', approverName: 'John Doe', status: 'APPROVED', decidedAt: '2026-09-05T15:00:00Z' },
      { id: 'as-3', stepOrder: 2, approverRole: 'FINANCE_MANAGER', status: 'PENDING' },
    ],
    status: 'IN_APPROVAL',
    createdAt: '2026-09-05T14:30:00Z',
  },
];
