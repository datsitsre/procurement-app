import { apiRequest } from './base';
import type { Page, ServiceResult, UUID } from '@/types/common';
import type { Payment, PaymentMethod } from '@/types/orders';

export interface ChargeInput {
  companyId: UUID;
  supplierId?: UUID;
  amount: number;
  currency: string;
  method: PaymentMethod;
  details: Record<string, string>;
  invoiceId?: UUID;
  orderId?: UUID;
}

export interface PaymentService {
  /** Paginated (Phase 19, section 1) - `?page=&pageSize=`, default 25, max 100, matching every
   *  other tenant-scoped list endpoint (`Page<Payment>`, not a bare array). */
  listPayments(companyId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<Payment>>>;
  /** Every payment across every company - the platform admin overview (section 46), paginated. */
  listAllPayments(page?: number, pageSize?: number): Promise<ServiceResult<Page<Payment>>>;
  /** Payments a supplier has received (section 44) - the supplier-workspace counterpart to
   *  `listPayments`, which is keyed by the *buyer's* company id instead. Paginated, same shape. */
  listPaymentsForSupplier(supplierId: UUID, page?: number, pageSize?: number): Promise<ServiceResult<Page<Payment>>>;
  /** Real database aggregation (Phase 19) - the finance/supplier dashboards' own "paid this
   *  month" stat, summed across the current calendar month, never just whatever page is
   *  currently loaded. */
  getPaidThisMonthTotal(companyId: UUID): Promise<ServiceResult<number>>;
  getPaidThisMonthTotalForSupplier(supplierId: UUID): Promise<ServiceResult<number>>;
}

/**
 * Calls the real `/api/{companies/[companyId]/payments,suppliers/[supplierId]/payments,
 * payments}` backend (Phase 14, Stage 8) for reading payment history. There is no client-
 * callable `charge` anymore - the real charge (server/services/payment.service.ts, same
 * PaymentProvider abstraction) now runs entirely server-side, invoked internally by
 * orders.service.ts's checkout and invoices.service.ts's payInvoice, never by the client
 * directly (the old mock's checkout page used to call this itself before creating the order).
 */
class ApiPaymentService implements PaymentService {
  async listPayments(companyId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<Payment>>> {
    return apiRequest<Page<Payment>>(`/api/companies/${companyId}/payments?page=${page}&pageSize=${pageSize}`);
  }

  async listAllPayments(page = 1, pageSize = 25): Promise<ServiceResult<Page<Payment>>> {
    return apiRequest<Page<Payment>>(`/api/payments?page=${page}&pageSize=${pageSize}`);
  }

  async listPaymentsForSupplier(supplierId: UUID, page = 1, pageSize = 25): Promise<ServiceResult<Page<Payment>>> {
    return apiRequest<Page<Payment>>(`/api/suppliers/${supplierId}/payments?page=${page}&pageSize=${pageSize}`);
  }

  async getPaidThisMonthTotal(companyId: UUID): Promise<ServiceResult<number>> {
    const result = await apiRequest<{ amount: number }>(`/api/companies/${companyId}/payments/paid-this-month`);
    return result.ok ? { ok: true, data: result.data.amount } : result;
  }

  async getPaidThisMonthTotalForSupplier(supplierId: UUID): Promise<ServiceResult<number>> {
    const result = await apiRequest<{ amount: number }>(`/api/suppliers/${supplierId}/payments/paid-this-month`);
    return result.ok ? { ok: true, data: result.data.amount } : result;
  }
}

export const paymentService: PaymentService = new ApiPaymentService();
