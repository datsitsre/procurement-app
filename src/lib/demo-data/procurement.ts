import type { PurchaseRequest, RFQ } from '@/types/procurement';

/** Minimal seeded RFQ/purchase-request records (section 65) - enough to back the buyer
 *  dashboard's "pending RFQs" / "pending approvals" widgets honestly, and to give the Phase 3
 *  placeholder list pages real (read-only) content instead of an empty shell. The full
 *  create-RFQ / respond-to-RFQ / negotiate / multi-step-approve workflows are Phase 3 work -
 *  this is just enough data to make what Phase 2 shows about them true. */

export const demoRfqs: RFQ[] = [
  {
    id: 'rfq-10082',
    reference: 'RFQ-10082',
    companyId: 'company-acme-gh',
    createdByUserId: 'user-john-doe',
    items: [{ id: 'rfqi-1', productId: 'prod-cisco-switch', productName: 'Cisco Catalyst Switch', quantity: 50 }],
    requiredDeliveryDate: '2026-09-20T00:00:00Z',
    deliveryLocation: 'Accra',
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

export const demoPurchaseRequests: PurchaseRequest[] = [
  {
    id: 'pr-10082',
    reference: 'PR-10082',
    companyId: 'company-acme-gh',
    requesterUserId: 'user-john-doe',
    requesterName: 'John Doe',
    department: 'IT',
    cartId: 'cart-seed-1',
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
    cartId: 'cart-seed-2',
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
