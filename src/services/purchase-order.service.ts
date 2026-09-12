import { delay, fail, ok } from './base';
import { demoPurchaseOrders } from '@/lib/demo-data/purchase-orders';
import { FLAT_DELIVERY_FEE, calculateTax } from '@/utils/pricing';
import type { ServiceResult, UUID } from '@/types/common';
import type { PurchaseOrder, Quote, RFQ } from '@/types/procurement';

const PO_STORE_KEY = 'procurement.purchase-orders.v1.list';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function readCreated(): PurchaseOrder[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(PO_STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PurchaseOrder[];
  } catch {
    return [];
  }
}

function appendCreated(po: PurchaseOrder) {
  if (typeof window === 'undefined') return;
  const list = readCreated();
  list.push(po);
  window.localStorage.setItem(PO_STORE_KEY, JSON.stringify(list));
}

function allPurchaseOrders(): PurchaseOrder[] {
  return [...demoPurchaseOrders, ...readCreated()];
}

export interface PurchaseOrderService {
  listPurchaseOrders(companyId: UUID): Promise<ServiceResult<PurchaseOrder[]>>;
  getPurchaseOrder(id: UUID): Promise<ServiceResult<PurchaseOrder>>;
  /** Builds and persists a PurchaseOrder from an accepted RFQ quote (section 24). Not part of
   *  the public ProcurementService interface - procurement.service.ts calls this internally
   *  when a quote is accepted, the same way a real backend's RFQ module would call into its
   *  own purchase-order module rather than duplicating PO-creation logic. */
  createFromQuote(rfq: RFQ, quote: Quote, authorizedByName: string): Promise<PurchaseOrder>;
}

class MockPurchaseOrderService implements PurchaseOrderService {
  async listPurchaseOrders(companyId: UUID): Promise<ServiceResult<PurchaseOrder[]>> {
    await delay(250);
    return ok(allPurchaseOrders().filter((po) => po.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async getPurchaseOrder(id: UUID): Promise<ServiceResult<PurchaseOrder>> {
    await delay(200);
    const po = allPurchaseOrders().find((p) => p.id === id);
    if (!po) return fail('NOT_FOUND', 'That purchase order could not be found.');
    return ok(po);
  }

  async createFromQuote(rfq: RFQ, quote: Quote, authorizedByName: string): Promise<PurchaseOrder> {
    await delay(200);
    const subtotal = quote.totalPrice;
    const tax = calculateTax(subtotal);
    const po: PurchaseOrder = {
      id: newId('po'),
      reference: `PO-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 89999)).slice(0, 5)}`,
      companyId: rfq.companyId,
      supplierId: quote.supplierId,
      supplierName: quote.supplierName,
      purchaseRequestId: undefined,
      items: quote.items.map((qi) => {
        const rfqItem = rfq.items.find((i) => i.productId === qi.productId);
        return {
          id: newId('poi'),
          productId: qi.productId,
          productName: rfqItem?.productName ?? qi.productId,
          quantity: qi.quantity,
          unitPrice: qi.unitPrice,
        };
      }),
      subtotal,
      tax,
      deliveryFee: FLAT_DELIVERY_FEE,
      total: subtotal + tax + FLAT_DELIVERY_FEE,
      paymentTerms: 'Net 30',
      deliveryLocation: rfq.deliveryLocation,
      authorizedByName,
      createdAt: new Date().toISOString(),
    };
    appendCreated(po);
    return po;
  }
}

export const purchaseOrderService: PurchaseOrderService = new MockPurchaseOrderService();
