import { assertPermission, delay, fail, ok, ownsRecord } from './base';
import { ordersService } from './orders.service';
import { demoBudgets } from '@/lib/demo-data/company-workspace';
import { Permission, type Role } from '@/config/rbac';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { Budget } from '@/types/company';

const BUDGET_STORE_KEY = 'procurement.budgets.v1.list';
const REMOVED_KEY = 'procurement.budgets.v1.removed';
const THRESHOLDS_KEY = 'procurement.budget-alert-thresholds.v1';

/** Default budget-alert thresholds (section 11.4) - a company can override these from Company
 *  Settings; until it does, everyone gets the same sensible defaults. */
export const DEFAULT_ALERT_THRESHOLDS = [70, 85, 100];

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function readList(): Budget[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(BUDGET_STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Budget[];
  } catch {
    return [];
  }
}

function writeList(list: Budget[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BUDGET_STORE_KEY, JSON.stringify(list));
}

function readRemoved(): Set<UUID> {
  if (typeof window === 'undefined') return new Set();
  const raw = window.localStorage.getItem(REMOVED_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as UUID[]);
  } catch {
    return new Set();
  }
}

function markRemoved(id: UUID) {
  if (typeof window === 'undefined') return;
  const removed = readRemoved();
  removed.add(id);
  window.localStorage.setItem(REMOVED_KEY, JSON.stringify(Array.from(removed)));
}

function allBudgets(): Budget[] {
  const removed = readRemoved();
  return [...demoBudgets, ...readList()].filter((b) => !removed.has(b.id));
}

function readThresholdOverrides(): Record<UUID, number[]> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(THRESHOLDS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, number[]>;
  } catch {
    return {};
  }
}

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
  /** A human label for the scope - the department name, cost center code, or "Company-wide". */
  label: string;
  spent: number;
  remaining: number;
  percentUsed: number;
  /** The highest alert threshold this budget's spend has crossed, or null if under all of them. */
  alertLevel: number | null;
}

export interface BudgetsService {
  listBudgets(companyId: UUID): Promise<ServiceResult<Budget[]>>;
  createBudget(input: NewBudgetInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Budget>>;
  removeBudget(budgetId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
  /** Every budget for this company with its live utilization computed from real paid orders -
   *  never a stored running total, so it can't drift out of sync with what was actually spent. */
  listUtilization(companyId: UUID): Promise<ServiceResult<BudgetUtilization[]>>;
  getAlertThresholds(companyId: UUID): Promise<ServiceResult<number[]>>;
  setAlertThresholds(companyId: UUID, thresholds: number[], callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
}

class MockBudgetsService implements BudgetsService {
  async listBudgets(companyId: UUID): Promise<ServiceResult<Budget[]>> {
    await delay(200);
    return ok(allBudgets().filter((b) => b.companyId === companyId));
  }

  async createBudget(input: NewBudgetInput, callerRole: Role, caller: TenantContext): Promise<ServiceResult<Budget>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, input.companyId)) return fail('NOT_FOUND', 'That company could not be found.');
    if (input.amount <= 0) return fail('INVALID_AMOUNT', 'Set a budget amount greater than zero.');

    const budget: Budget = {
      id: newId('budget'),
      companyId: input.companyId,
      scope: input.scope,
      department: input.department,
      costCenterId: input.costCenterId,
      period: input.period,
      year: input.year,
      month: input.month,
      amount: input.amount,
    };
    writeList([...readList(), budget]);
    return ok(budget);
  }

  async removeBudget(budgetId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(200);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const budget = allBudgets().find((b) => b.id === budgetId);
    if (!budget || !ownsRecord(caller, budget.companyId)) return fail('NOT_FOUND', 'That budget could not be found.');

    markRemoved(budgetId);
    return ok(undefined);
  }

  async listUtilization(companyId: UUID): Promise<ServiceResult<BudgetUtilization[]>> {
    await delay(300);
    const budgets = allBudgets().filter((b) => b.companyId === companyId);
    const ordersResult = await ordersService.listOrders(companyId);
    const orders = ordersResult.ok ? ordersResult.data.filter((o) => o.paymentStatus === 'PAID') : [];
    const thresholdsResult = await this.getAlertThresholds(companyId);
    const thresholds = thresholdsResult.ok ? thresholdsResult.data : DEFAULT_ALERT_THRESHOLDS;

    const utilization = budgets.map((budget) => {
      const inPeriod = orders.filter((o) => {
        const created = new Date(o.createdAt);
        if (created.getFullYear() !== budget.year) return false;
        if (budget.period === 'MONTHLY' && created.getMonth() + 1 !== budget.month) return false;
        return true;
      });
      const scoped = inPeriod.filter((o) => {
        if (budget.scope === 'COMPANY') return true;
        if (budget.scope === 'DEPARTMENT') return o.department === budget.department;
        if (budget.scope === 'COST_CENTER') return o.costCenterId === budget.costCenterId;
        return false;
      });
      const spent = scoped.reduce((sum, o) => sum + o.total, 0);
      const percentUsed = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
      const alertLevel = [...thresholds].sort((a, b) => b - a).find((t) => percentUsed >= t) ?? null;
      const label =
        budget.scope === 'COMPANY' ? 'Company-wide' : budget.scope === 'DEPARTMENT' ? (budget.department ?? 'Department') : 'Cost center';

      return { budget, label, spent, remaining: budget.amount - spent, percentUsed, alertLevel };
    });

    return ok(utilization);
  }

  async getAlertThresholds(companyId: UUID): Promise<ServiceResult<number[]>> {
    await delay(100);
    const overrides = readThresholdOverrides();
    return ok(overrides[companyId] ?? DEFAULT_ALERT_THRESHOLDS);
  }

  async setAlertThresholds(companyId: UUID, thresholds: number[], callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(200);
    const permissionError = assertPermission(callerRole, Permission.SETTINGS_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, companyId)) return fail('NOT_FOUND', 'That company could not be found.');
    if (thresholds.some((t) => t <= 0 || t > 200)) return fail('INVALID_THRESHOLD', 'Thresholds must be between 1 and 200%.');

    const overrides = readThresholdOverrides();
    overrides[companyId] = [...thresholds].sort((a, b) => a - b);
    if (typeof window !== 'undefined') window.localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(overrides));
    return ok(undefined);
  }
}

export const budgetsService: BudgetsService = new MockBudgetsService();
