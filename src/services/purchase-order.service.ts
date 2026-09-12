import { delay, fail, ok } from './base';
import { demoPurchaseOrders } from '@/lib/demo-data/purchase-orders';
import { demoCompanies } from '@/lib/demo-data/companies';
import { FLAT_DELIVERY_FEE, calculateTax } from '@/utils/pricing';
import type { ServiceResult, UUID } from '@/types/common';
import type { PurchaseOrder, PurchaseRequest, Quote, RFQ } from '@/types/procurement';

const PO_STORE_KEY = 'procurement.purchase-orders.v1.list';
const PO_OVERRIDE_KEY = 'procurement.purchase-orders.v1.overrides';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function poReference(): string {
  return `PO-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 89999)).slice(0, 5)}`;
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

/** Overrides keyed by PO id - lets checkout mark a *seeded* demo PO's `orderId` (or any other
 *  future in-place edit) without duplicating it into the created list. */
function readOverrides(): Record<UUID, PurchaseOrder> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(PO_OVERRIDE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, PurchaseOrder>;
  } catch {
    return {};
  }
}

function writeOverride(po: PurchaseOrder) {
  if (typeof window === 'undefined') return;
  const store = readOverrides();
  store[po.id] = po;
  window.localStorage.setItem(PO_OVERRIDE_KEY, JSON.stringify(store));
}

function allPurchaseOrders(): PurchaseOrder[] {
  const overrides = readOverrides();
  const seeded = demoPurchaseOrders.map((po) => overrides[po.id] ?? po);
  const created = readCreated().map((po) => overrides[po.id] ?? po);
  return [...seeded, ...created];
}

export interface PurchaseOrderService {
  listPurchaseOrders(companyId: UUID): Promise<ServiceResult<PurchaseOrder[]>>;
  getPurchaseOrder(id: UUID): Promise<ServiceResult<PurchaseOrder>>;
  listForPurchaseRequest(purchaseRequestId: UUID): Promise<ServiceResult<PurchaseOrder[]>>;
  /** Builds and persists a PurchaseOrder from an accepted RFQ quote (section 24). Not part of
   *  the public ProcurementService interface - procurement.service.ts calls this internally
   *  when a quote is accepted, the same way a real backend's RFQ module would call into its
   *  own purchase-order module rather than duplicating PO-creation logic. */
  createFromQuote(rfq: RFQ, quote: Quote, authorizedByName: string): Promise<PurchaseOrder>;
  /** Builds one PurchaseOrder per distinct supplier represented in a fully-approved purchase
   *  request's items (section 64: "Approved -> Create PO") - called internally by
   *  procurement.service.ts's decideStep once every approval step is APPROVED. */
  createFromPurchaseRequest(pr: PurchaseRequest, authorizedByName: string): Promise<PurchaseOrder[]>;
  /** Records that checkout (section 25) has turned this PO into a real order - called by the
   *  checkout flow right after orders.service creates the Order. */
  markConverted(purchaseOrderId: UUID, orderId: UUID): Promise<ServiceResult<PurchaseOrder>>;
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

  async listForPurchaseRequest(purchaseRequestId: UUID): Promise<ServiceResult<PurchaseOrder[]>> {
    await delay(150);
    return ok(allPurchaseOrders().filter((po) => po.purchaseRequestId === purchaseRequestId));
  }

  async createFromQuote(rfq: RFQ, quote: Quote, authorizedByName: string): Promise<PurchaseOrder> {
    await delay(200);
    const subtotal = quote.totalPrice;
    const tax = calculateTax(subtotal);
    const po: PurchaseOrder = {
      id: newId('po'),
      reference: poReference(),
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

  async createFromPurchaseRequest(pr: PurchaseRequest, authorizedByName: string): Promise<PurchaseOrder[]> {
    await delay(300);
    const company = demoCompanies.find((c) => c.id === pr.companyId);
    const paymentTerms = company ? company.creditTerms.replace('_', ' ') : 'Net 30';
    const deliveryLocation = company?.addresses.find((a) => a.isDefault)?.line1 ?? 'Company warehouse';

    const bySupplier = new Map<string, typeof pr.items>();
    for (const item of pr.items) {
      bySupplier.set(item.supplierId, [...(bySupplier.get(item.supplierId) ?? []), item]);
    }

    const created: PurchaseOrder[] = [];
    for (const [supplierId, items] of bySupplier) {
      const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
      const tax = calculateTax(subtotal);
      const po: PurchaseOrder = {
        id: newId('po'),
        reference: poReference(),
        companyId: pr.companyId,
        supplierId,
        supplierName: items[0].supplierName,
        purchaseRequestId: pr.id,
        items: items.map((i) => ({ id: newId('poi'), productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })),
        subtotal,
        tax,
        deliveryFee: FLAT_DELIVERY_FEE,
        total: subtotal + tax + FLAT_DELIVERY_FEE,
        paymentTerms,
        deliveryLocation,
        authorizedByName,
        createdAt: new Date().toISOString(),
      };
      appendCreated(po);
      created.push(po);
    }
    return created;
  }

  async markConverted(purchaseOrderId: UUID, orderId: UUID): Promise<ServiceResult<PurchaseOrder>> {
    await delay(150);
    const po = allPurchaseOrders().find((p) => p.id === purchaseOrderId);
    if (!po) return fail('NOT_FOUND', 'That purchase order could not be found.');
    const updated: PurchaseOrder = { ...po, orderId };
    writeOverride(updated);
    return ok(updated);
  }
}

export const purchaseOrderService: PurchaseOrderService = new MockPurchaseOrderService();
