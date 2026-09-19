import { apiRequest } from './base';
import type { Page, ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Delivery, Order, OrderTimelineEvent, PaymentMethod, Shipment } from '@/types/orders';
import type { PurchaseOrder } from '@/types/procurement';
import type { Role } from '@/config/rbac';

export interface OrderSummary {
  totalSpend: number;
  monthlySpend: number;
  openOrders: number;
}

export interface OrdersService {
  listOrders(companyId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<Order>>>;
  /** Total/monthly spend and open-order count, computed server-side (Phase 16) - never derive
   *  these from a page of `listOrders`, which only ever holds one page's worth of rows. */
  getOrderSummary(companyId: UUID): Promise<ServiceResult<OrderSummary>>;
  /** Every order across every company - the platform admin overview (section 46). */
  listAllOrders(page?: number, pageSize?: number): Promise<ServiceResult<Page<Order>>>;
  /** Fetched by a URL path segment (section 9.2) - `caller` must own the order (as the buying
   *  company or the fulfilling supplier) or be a platform admin, or this returns NOT_FOUND the
   *  same way a truly missing id would, rather than leaking another tenant's order data. */
  getOrder(id: UUID, caller: TenantContext): Promise<ServiceResult<Order>>;
  getOrderForPurchaseOrder(purchaseOrderId: UUID): Promise<ServiceResult<Order | null>>;
  listTimeline(orderId: UUID): Promise<ServiceResult<OrderTimelineEvent[]>>;
  listShipments(orderId: UUID): Promise<ServiceResult<Shipment[]>>;
  listDeliveries(orderId: UUID): Promise<ServiceResult<Delivery[]>>;
  /** Checks out a purchase order (section 25) - charges payment and raises the invoice
   *  server-side, in the same request, then confirms the resulting order. `details` carries
   *  whatever the chosen method needs (a card number, a mobile money phone number, ...); can
   *  genuinely fail now (an invalid card, insufficient credit, the PO already converted, ...). */
  createFromPurchaseOrder(po: PurchaseOrder, method: PaymentMethod, details: Record<string, string>): Promise<ServiceResult<Order>>;

  /** Orders a supplier needs to fulfill (section 44) - the supplier-workspace counterpart to
   *  `listOrders`, which is keyed by the *buyer's* company id instead. */
  listOrdersForSupplier(supplierId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<Order>>>;
  /** Count of orders in CONFIRMED/PROCESSING status - computed server-side (Phase 16). */
  getSupplierOrdersToFulfillCount(supplierId: UUID): Promise<ServiceResult<number>>;
  /** CONFIRMED -> PROCESSING: the supplier has started preparing the order. `caller` must be
   *  the fulfilling supplier (section 9.2) - ORDERS_FULFILL alone only proves the role can
   *  fulfill *some* order, not that this one is theirs. */
  markProcessing(orderId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Order>>;
  /** PROCESSING -> SHIPPED: hands the order to a driver, moving its shipment to IN_TRANSIT. */
  dispatchOrder(orderId: UUID, driverName: string, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Order>>;
  /** SHIPPED -> DELIVERED: records a full delivery for every line and closes out the
   *  shipment. */
  markDelivered(orderId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Order>>;
  // markRefunded is gone from this client interface (Phase 14, Stage 7) - resolving a dispute
  // now happens entirely server-side (server/services/disputes.service.ts's resolveDispute calls
  // server/services/orders.service.ts's markRefunded directly), never a separate client call.
}

/**
 * Calls the real `/api/companies/[companyId]/orders`, `/api/orders/[id]/*`, and
 * `/api/suppliers/[supplierId]/orders` backend (Phase 14, Stage 7). `callerRole`/`caller` are
 * still accepted on several methods (every existing page already passes them) but are never
 * sent over the wire and never trusted for authorization - the API derives the caller's role and
 * tenant from the session cookie itself.
 */
class ApiOrdersService implements OrdersService {
  async listOrders(companyId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<Order>>> {
    return apiRequest<Page<Order>>(`/api/companies/${companyId}/orders?page=${page}&pageSize=${pageSize}`);
  }

  async getOrderSummary(companyId: UUID): Promise<ServiceResult<OrderSummary>> {
    return apiRequest<OrderSummary>(`/api/companies/${companyId}/orders/summary`);
  }

  async listAllOrders(page = 1, pageSize = 25): Promise<ServiceResult<Page<Order>>> {
    return apiRequest<Page<Order>>(`/api/orders?page=${page}&pageSize=${pageSize}`);
  }

  async getOrder(id: UUID): Promise<ServiceResult<Order>> {
    return apiRequest<Order>(`/api/orders/${id}`);
  }

  async getOrderForPurchaseOrder(purchaseOrderId: UUID): Promise<ServiceResult<Order | null>> {
    const result = await apiRequest<Order>(`/api/purchase-orders/${purchaseOrderId}`);
    // Not every PO has an order yet - a 404 here just means "no order for this PO", not an error.
    if (!result.ok) return { ok: true, data: null };
    return { ok: true, data: result.data };
  }

  async listTimeline(orderId: UUID): Promise<ServiceResult<OrderTimelineEvent[]>> {
    return apiRequest<OrderTimelineEvent[]>(`/api/orders/${orderId}/timeline`);
  }

  async listShipments(orderId: UUID): Promise<ServiceResult<Shipment[]>> {
    return apiRequest<Shipment[]>(`/api/orders/${orderId}/shipments`);
  }

  async listDeliveries(orderId: UUID): Promise<ServiceResult<Delivery[]>> {
    return apiRequest<Delivery[]>(`/api/orders/${orderId}/deliveries`);
  }

  async createFromPurchaseOrder(po: PurchaseOrder, method: PaymentMethod, details: Record<string, string>): Promise<ServiceResult<Order>> {
    return apiRequest<Order>(`/api/purchase-orders/${po.id}/checkout`, { method: 'POST', body: JSON.stringify({ method, details }) });
  }

  async listOrdersForSupplier(supplierId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<Order>>> {
    return apiRequest<Page<Order>>(`/api/suppliers/${supplierId}/orders?page=${page}&pageSize=${pageSize}`);
  }

  async getSupplierOrdersToFulfillCount(supplierId: UUID): Promise<ServiceResult<number>> {
    const result = await apiRequest<{ count: number }>(`/api/suppliers/${supplierId}/orders/to-fulfill-count`);
    return result.ok ? { ok: true, data: result.data.count } : result;
  }

  async markProcessing(orderId: UUID): Promise<ServiceResult<Order>> {
    return apiRequest<Order>(`/api/orders/${orderId}/processing`, { method: 'POST' });
  }

  async dispatchOrder(orderId: UUID, driverName: string): Promise<ServiceResult<Order>> {
    return apiRequest<Order>(`/api/orders/${orderId}/dispatch`, { method: 'POST', body: JSON.stringify({ driverName }) });
  }

  async markDelivered(orderId: UUID): Promise<ServiceResult<Order>> {
    return apiRequest<Order>(`/api/orders/${orderId}/delivered`, { method: 'POST' });
  }
}

export const ordersService: OrdersService = new ApiOrdersService();
