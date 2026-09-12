import type { PurchaseOrder } from '@/types/procurement';

export const demoPurchaseOrders: PurchaseOrder[] = [
  {
    id: 'po-2026-00182',
    reference: 'PO-2026-00182',
    companyId: 'company-acme-gh',
    supplierId: 'supplier-abc',
    supplierName: 'ABC Technology Solutions',
    items: [{ id: 'poi-1', productId: 'prod-cisco-switch', productName: 'Cisco Catalyst Switch', quantity: 5, unitPrice: 8100 }],
    subtotal: 40500,
    tax: 5063,
    deliveryFee: 500,
    total: 46063,
    paymentTerms: 'Net 30',
    deliveryLocation: 'Accra Warehouse',
    authorizedByName: 'Sarah Smith',
    orderId: 'order-10082',
    createdAt: '2026-09-08T15:30:00Z',
  },
];
