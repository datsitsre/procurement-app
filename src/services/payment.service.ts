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
  listPayments(companyId: UUID): Promise<ServiceResult<Payment[]>>;
  /** Every payment across every company - the platform admin overview (section 46), paginated. */
  listAllPayments(page?: number, pageSize?: number): Promise<ServiceResult<Page<Payment>>>;
  /** Payments a supplier has received (section 44) - the supplier-workspace counterpart to
   *  `listPayments`, which is keyed by the *buyer's* company id instead. */
  listPaymentsForSupplier(supplierId: UUID): Promise<ServiceResult<Payment[]>>;
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
  async listPayments(companyId: UUID): Promise<ServiceResult<Payment[]>> {
    return apiRequest<Payment[]>(`/api/companies/${companyId}/payments`);
  }

  async listAllPayments(page = 1, pageSize = 25): Promise<ServiceResult<Page<Payment>>> {
    return apiRequest<Page<Payment>>(`/api/payments?page=${page}&pageSize=${pageSize}`);
  }

  async listPaymentsForSupplier(supplierId: UUID): Promise<ServiceResult<Payment[]>> {
    return apiRequest<Payment[]>(`/api/suppliers/${supplierId}/payments`);
  }
}

export const paymentService: PaymentService = new ApiPaymentService();
