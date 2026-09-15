import { apiRequest } from './base';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { PurchaseTemplateItem, RecurringFrequency, RecurringPurchase } from '@/types/procurement';
import type { Role } from '@/config/rbac';

/**
 * Real, database-backed (Phase 15 - procurement backend completion). Calls the
 * `/api/companies/[companyId]/recurring-purchases*` backend instead of `localStorage`.
 *
 * `runDue` no longer computes anything client-side - the mock's own comment used to describe it
 * as "a deliberate, visible stand-in for a cron job"; it now just asks the server to run its real
 * sweep (POST .../recurring-purchases/run-due), the exact same function the real
 * `/api/cron/recurring-purchase-sweep` route calls on a schedule. The browser triggers the work;
 * it never performs it.
 */

export interface NewRecurringPurchaseInput {
  companyId: UUID;
  name: string;
  items: PurchaseTemplateItem[];
  frequency: RecurringFrequency;
  customIntervalDays?: number;
  requesterUserId: UUID;
  requesterName: string;
  department?: string;
  costCenterId?: UUID;
}

export interface RunDueOutcome {
  ranCount: number;
  createdPurchaseRequestIds: UUID[];
  warnings: string[];
}

export interface RecurringService {
  listRecurringPurchases(companyId: UUID): Promise<ServiceResult<RecurringPurchase[]>>;
  createRecurringPurchase(input: NewRecurringPurchaseInput, callerRole: Role): Promise<ServiceResult<RecurringPurchase>>;
  setActive(id: UUID, active: boolean, callerRole: Role, caller: TenantContext): Promise<ServiceResult<RecurringPurchase>>;
  removeRecurringPurchase(id: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
  runDue(companyId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<RunDueOutcome>>;
}

class ApiRecurringService implements RecurringService {
  async listRecurringPurchases(companyId: UUID): Promise<ServiceResult<RecurringPurchase[]>> {
    return apiRequest<RecurringPurchase[]>(`/api/companies/${companyId}/recurring-purchases`);
  }

  async createRecurringPurchase(input: NewRecurringPurchaseInput): Promise<ServiceResult<RecurringPurchase>> {
    // requesterUserId/requesterName are never sent - the server derives the requester from the
    // session itself, never a client-supplied id.
    const body = {
      name: input.name,
      items: input.items,
      frequency: input.frequency,
      customIntervalDays: input.customIntervalDays,
      department: input.department,
      costCenterId: input.costCenterId,
    };
    return apiRequest<RecurringPurchase>(`/api/companies/${input.companyId}/recurring-purchases`, { method: 'POST', body: JSON.stringify(body) });
  }

  async setActive(id: UUID, active: boolean, _callerRole: Role, caller: TenantContext): Promise<ServiceResult<RecurringPurchase>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That recurring purchase could not be found.' } };
    return apiRequest<RecurringPurchase>(`/api/companies/${companyId}/recurring-purchases/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
  }

  async removeRecurringPurchase(id: UUID, _callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That recurring purchase could not be found.' } };
    const result = await apiRequest<{ ok: true }>(`/api/companies/${companyId}/recurring-purchases/${id}`, { method: 'DELETE' });
    return result.ok ? { ok: true, data: undefined } : result;
  }

  async runDue(companyId: UUID): Promise<ServiceResult<RunDueOutcome>> {
    return apiRequest<RunDueOutcome>(`/api/companies/${companyId}/recurring-purchases/run-due`, { method: 'POST' });
  }
}

export const recurringService: RecurringService = new ApiRecurringService();
