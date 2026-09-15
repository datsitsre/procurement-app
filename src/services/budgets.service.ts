import { apiRequest } from './base';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Budget } from '@/types/company';
import type { Role } from '@/config/rbac';

/** Real, database-backed (Phase 15 - procurement backend completion). Calls the
 *  `/api/companies/[companyId]/budgets*` backend instead of `localStorage` - the server derives
 *  the caller's role/tenant from the session itself, so `callerRole`/`tenant` are accepted here
 *  only because every existing call site already passes them (nothing sends them over the wire).
 *  Utilization is still computed server-side, live, from real paid orders - never a stored
 *  running total. */

export const DEFAULT_ALERT_THRESHOLDS = [70, 85, 100];

export interface NewBudgetInput {
  companyId: UUID;
  scope: Budget['scope'];
  department?: string;
  costCenterId?: UUID;
  period: Budget['period'];
  year: number;
  month?: number;
  amount: number;
}

export interface BudgetUtilization {
  budget: Budget;
  label: string;
  spent: number;
  remaining: number;
  percentUsed: number;
  alertLevel: number | null;
}

export interface BudgetsService {
  listBudgets(companyId: UUID): Promise<ServiceResult<Budget[]>>;
  createBudget(input: NewBudgetInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Budget>>;
  removeBudget(budgetId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
  listUtilization(companyId: UUID): Promise<ServiceResult<BudgetUtilization[]>>;
  getAlertThresholds(companyId: UUID): Promise<ServiceResult<number[]>>;
  setAlertThresholds(companyId: UUID, thresholds: number[], callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
}

class ApiBudgetsService implements BudgetsService {
  async listBudgets(companyId: UUID): Promise<ServiceResult<Budget[]>> {
    return apiRequest<Budget[]>(`/api/companies/${companyId}/budgets`);
  }

  async createBudget(input: NewBudgetInput): Promise<ServiceResult<Budget>> {
    const { companyId, ...body } = input;
    return apiRequest<Budget>(`/api/companies/${companyId}/budgets`, { method: 'POST', body: JSON.stringify(body) });
  }

  async removeBudget(budgetId: UUID, _callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That budget could not be found.' } };
    const result = await apiRequest<{ ok: true }>(`/api/companies/${companyId}/budgets/${budgetId}`, { method: 'DELETE' });
    return result.ok ? { ok: true, data: undefined } : result;
  }

  async listUtilization(companyId: UUID): Promise<ServiceResult<BudgetUtilization[]>> {
    return apiRequest<BudgetUtilization[]>(`/api/companies/${companyId}/budget-utilization`);
  }

  async getAlertThresholds(companyId: UUID): Promise<ServiceResult<number[]>> {
    return apiRequest<number[]>(`/api/companies/${companyId}/budget-alert-thresholds`);
  }

  async setAlertThresholds(companyId: UUID, thresholds: number[]): Promise<ServiceResult<void>> {
    const result = await apiRequest<{ ok: true }>(`/api/companies/${companyId}/budget-alert-thresholds`, {
      method: 'PUT',
      body: JSON.stringify({ thresholds }),
    });
    return result.ok ? { ok: true, data: undefined } : result;
  }
}

export const budgetsService: BudgetsService = new ApiBudgetsService();
