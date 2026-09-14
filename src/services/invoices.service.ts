import { apiRequest } from './base';
import type { Role } from '@/config/rbac';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Invoice, PaymentMethod } from '@/types/orders';

export interface InvoicesService {
  listInvoices(companyId: UUID): Promise<ServiceResult<Invoice[]>>;
  /** Fetched by a URL path segment (section 9.2) - `caller` must be the billed company, the
   *  issuing supplier, or a platform admin, or this returns NOT_FOUND rather than leaking
   *  another tenant's invoice. */
  getInvoice(id: UUID, caller: TenantContext): Promise<ServiceResult<Invoice>>;
  getInvoiceForOrder(orderId: UUID): Promise<ServiceResult<Invoice | null>>;
  /** Invoices a supplier has issued (section 44) - the supplier-workspace counterpart to
   *  `listInvoices`, which is keyed by the *buyer's* company id instead. */
  listInvoicesForSupplier(supplierId: UUID): Promise<ServiceResult<Invoice[]>>;
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
  async listInvoices(companyId: UUID): Promise<ServiceResult<Invoice[]>> {
    return apiRequest<Invoice[]>(`/api/companies/${companyId}/invoices`);
  }

  async getInvoice(id: UUID): Promise<ServiceResult<Invoice>> {
    return apiRequest<Invoice>(`/api/invoices/${id}`);
  }

  async getInvoiceForOrder(orderId: UUID): Promise<ServiceResult<Invoice | null>> {
    return apiRequest<Invoice | null>(`/api/orders/${orderId}/invoice`);
  }

  async listInvoicesForSupplier(supplierId: UUID): Promise<ServiceResult<Invoice[]>> {
    return apiRequest<Invoice[]>(`/api/suppliers/${supplierId}/invoices`);
  }

  async payInvoice(invoiceId: UUID, method: PaymentMethod, details: Record<string, string>): Promise<ServiceResult<Invoice>> {
    return apiRequest<Invoice>(`/api/invoices/${invoiceId}/pay`, { method: 'POST', body: JSON.stringify({ method, details }) });
  }
}

export const invoicesService: InvoicesService = new ApiInvoicesService();
