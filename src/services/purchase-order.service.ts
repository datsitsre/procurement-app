import { apiRequest } from './base';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { PurchaseOrder } from '@/types/procurement';

export interface PurchaseOrderService {
  listPurchaseOrders(companyId: UUID): Promise<ServiceResult<PurchaseOrder[]>>;
  /** Fetched by a URL path segment (section 9.2) - `caller` must be the buying company, the
   *  fulfilling supplier, or a platform admin, or this returns NOT_FOUND rather than leaking
   *  another tenant's purchase order. */
  getPurchaseOrder(id: UUID, caller: TenantContext): Promise<ServiceResult<PurchaseOrder>>;
  listForPurchaseRequest(purchaseRequestId: UUID): Promise<ServiceResult<PurchaseOrder[]>>;
}

/**
 * Calls the real `/api/companies/[companyId]/purchase-orders`, `/api/purchase-orders/[id]`, and
 * `/api/purchase-requests/[id]/purchase-orders` backend (Phase 14, Stage 7). Building a
 * PurchaseOrder from an accepted quote or a fully-approved purchase request is now the server's
 * job, done inline by procurement.service.ts's own acceptQuote/decideStep - this service is
 * read-only from the client's side (see server/services/purchase-order.service.ts's own
 * comment). `caller` is still accepted on `getPurchaseOrder` (every existing page already passes
 * it) but never sent over the wire or trusted for authorization.
 */
class ApiPurchaseOrderService implements PurchaseOrderService {
  async listPurchaseOrders(companyId: UUID): Promise<ServiceResult<PurchaseOrder[]>> {
    return apiRequest<PurchaseOrder[]>(`/api/companies/${companyId}/purchase-orders`);
  }

  async getPurchaseOrder(id: UUID): Promise<ServiceResult<PurchaseOrder>> {
    return apiRequest<PurchaseOrder>(`/api/purchase-orders/${id}`);
  }

  async listForPurchaseRequest(purchaseRequestId: UUID): Promise<ServiceResult<PurchaseOrder[]>> {
    return apiRequest<PurchaseOrder[]>(`/api/purchase-requests/${purchaseRequestId}/purchase-orders`);
  }
}

export const purchaseOrderService: PurchaseOrderService = new ApiPurchaseOrderService();
