import { apiRequest } from './base';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Dispute } from '@/types/orders';
import type { Role } from '@/config/rbac';
import type { Actor } from './catalog.service';

export interface NewDisputeInput {
  orderId: UUID;
  reason: string;
  description: string;
}

export interface DisputesService {
  listDisputes(companyId: UUID): Promise<ServiceResult<Dispute[]>>;
  listDisputesForSupplier(supplierId: UUID): Promise<ServiceResult<Dispute[]>>;
  getDisputeForOrder(orderId: UUID): Promise<ServiceResult<Dispute | null>>;
  /** Every dispute across every company - the admin dispute queue (section 46/49). */
  listAllDisputes(): Promise<ServiceResult<Dispute[]>>;
  /** A buyer reports an issue with a delivered order (section 46). `orderReference`,
   *  `companyId`, and `supplierId` are derived from the real order record server-side, never
   *  trusted from the caller directly - `caller` is still accepted (every existing page already
   *  passes it) but never sent over the wire. */
  createDispute(input: NewDisputeInput, caller: TenantContext): Promise<ServiceResult<Dispute>>;
  /** A platform admin closes out a dispute - RESOLVED_REFUND also marks the underlying order's
   *  payment REFUNDED, done server-side in the same request. `callerRole`/`actor` are still
   *  accepted but never sent over the wire - the API derives the actor from the session. */
  resolveDispute(
    disputeId: UUID,
    decision: 'RESOLVED_REFUND' | 'RESOLVED_REJECTED',
    note: string,
    callerRole: Role,
    actor: Actor,
  ): Promise<ServiceResult<Dispute>>;
}

/**
 * Calls the real `/api/{companies/[companyId],suppliers/[supplierId]}/disputes`,
 * `/api/orders/[id]/dispute`, and `/api/disputes*` backend (Phase 14, Stage 7).
 */
class ApiDisputesService implements DisputesService {
  async listDisputes(companyId: UUID): Promise<ServiceResult<Dispute[]>> {
    return apiRequest<Dispute[]>(`/api/companies/${companyId}/disputes`);
  }

  async listDisputesForSupplier(supplierId: UUID): Promise<ServiceResult<Dispute[]>> {
    return apiRequest<Dispute[]>(`/api/suppliers/${supplierId}/disputes`);
  }

  async getDisputeForOrder(orderId: UUID): Promise<ServiceResult<Dispute | null>> {
    return apiRequest<Dispute | null>(`/api/orders/${orderId}/dispute`);
  }

  async listAllDisputes(): Promise<ServiceResult<Dispute[]>> {
    return apiRequest<Dispute[]>('/api/disputes');
  }

  async createDispute(input: NewDisputeInput): Promise<ServiceResult<Dispute>> {
    return apiRequest<Dispute>('/api/disputes', { method: 'POST', body: JSON.stringify(input) });
  }

  async resolveDispute(disputeId: UUID, decision: 'RESOLVED_REFUND' | 'RESOLVED_REJECTED', note: string): Promise<ServiceResult<Dispute>> {
    return apiRequest<Dispute>(`/api/disputes/${disputeId}/resolve`, { method: 'POST', body: JSON.stringify({ decision, note }) });
  }
}

export const disputesService: DisputesService = new ApiDisputesService();
