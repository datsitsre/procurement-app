import { apiRequest } from './base';
import type { Role } from '@/config/rbac';
import type { Page, ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Invoice, PaymentMethod } from '@/types/orders';

export interface InvoiceAgingSummary {
  current: number;
  overdue1to30: number;
  overdue31to60: number;
  overdue61to90: number;
  overdue90plus: number;
  total: number;
  count: number;
  overdueCount: number;
  overdueAmount: number;
}

export interface InvoicesService {
  /** Paginated (Phase 19, section 1) - `?page=&pageSize=`, default 25, max 100, matching every
   *  other tenant-scoped list endpoint (`Page<Invoice>`, not a bare array). */
  listInvoices(companyId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<Invoice>>>;
  /** Fetched by a URL path segment (section 9.2) - `caller` must be the billed company, the
   *  issuing supplier, or a platform admin, or this returns NOT_FOUND rather than leaking
   *  another tenant's invoice. */
  getInvoice(id: UUID, caller: TenantContext): Promise<ServiceResult<Invoice>>;
  getInvoiceForOrder(orderId: UUID): Promise<ServiceResult<Invoice | null>>;
  /** Invoices a supplier has issued (section 44) - the supplier-workspace counterpart to
   *  `listInvoices`, which is keyed by the *buyer's* company id instead. Paginated, same shape. */
  listInvoicesForSupplier(supplierId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<Invoice>>>;
  /** Real database aggregation (Phase 19) - the aging buckets the balance-sheet page and every
   *  dashboard's own "outstanding"/"overdue" stat needs, computed across the company's *entire*
   *  outstanding-invoice set, never just whatever page is currently loaded. */
  getInvoiceAgingSummary(companyId: UUID): Promise<ServiceResult<InvoiceAgingSummary>>;
  getInvoiceAgingSummaryForSupplier(supplierId: UUID): Promise<ServiceResult<InvoiceAgingSummary>>;
  /** The finance dashboard's own "needs attention" list - the soonest-due outstanding invoices. */
  getInvoicesNeedingAttention(companyId: UUID): Promise<ServiceResult<Invoice[]>>;
  /** Pays down (or fully settles) an invoice through the payment abstraction, updating
   *  `amountPaid`/`status` from the resulting charge. */
  payInvoice(
    invoiceId: UUID,
    method: PaymentMethod,
    details: Record<string, string>,
    callerRole: Role,
    caller: TenantContext,
  ): Promise<ServiceResult<Invoice>>;
}

/**
 * Calls the real `/api/{companies/[companyId],suppliers/[supplierId]}/invoices`,
 * `/api/invoices/[id]*`, and `/api/orders/[id]/invoice` backend (Phase 14, Stage 8). Raising an
 * invoice for a newly-checked-out order is now the server's job, done inline by
 * orders.service.ts's own createFromPurchaseOrder - there is no client-callable `createForOrder`
 * anymore (the checkout page used to call it itself, right after creating the order).
 * `callerRole`/`caller` are still accepted on `getInvoice`/`payInvoice` (every existing page
 * already passes them) but never sent over the wire or trusted for authorization.
 */
class ApiInvoicesService implements InvoicesService {
  async listInvoices(companyId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<Invoice>>> {
    return apiRequest<Page<Invoice>>(`/api/companies/${companyId}/invoices?page=${page}&pageSize=${pageSize}`);
  }

  async getInvoice(id: UUID): Promise<ServiceResult<Invoice>> {
    return apiRequest<Invoice>(`/api/invoices/${id}`);
  }

  async getInvoiceForOrder(orderId: UUID): Promise<ServiceResult<Invoice | null>> {
    return apiRequest<Invoice | null>(`/api/orders/${orderId}/invoice`);
  }

  async listInvoicesForSupplier(supplierId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<Invoice>>> {
    return apiRequest<Page<Invoice>>(`/api/suppliers/${supplierId}/invoices?page=${page}&pageSize=${pageSize}`);
  }

  async getInvoiceAgingSummary(companyId: UUID): Promise<ServiceResult<InvoiceAgingSummary>> {
    return apiRequest<InvoiceAgingSummary>(`/api/companies/${companyId}/invoices/aging-summary`);
  }

  async getInvoiceAgingSummaryForSupplier(supplierId: UUID): Promise<ServiceResult<InvoiceAgingSummary>> {
    return apiRequest<InvoiceAgingSummary>(`/api/suppliers/${supplierId}/invoices/aging-summary`);
  }

  async getInvoicesNeedingAttention(companyId: UUID): Promise<ServiceResult<Invoice[]>> {
    return apiRequest<Invoice[]>(`/api/companies/${companyId}/invoices/needing-attention`);
  }

  async payInvoice(invoiceId: UUID, method: PaymentMethod, details: Record<string, string>): Promise<ServiceResult<Invoice>> {
    return apiRequest<Invoice>(`/api/invoices/${invoiceId}/pay`, { method: 'POST', body: JSON.stringify({ method, details }) });
  }
}

export const invoicesService: InvoicesService = new ApiInvoicesService();
