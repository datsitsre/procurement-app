import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { recordAudit } from '@/server/services/audit.service';
import type { ServiceResult, UUID } from '@/types/common';
import type { Budget, BudgetPeriod, BudgetScope } from '@/types/company';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The real, database-backed counterpart to src/services/budgets.service.ts's localStorage mock
 * (Phase 15 - procurement backend completion). The `Budget`/`BudgetAlertSettings` Prisma models
 * already existed in the schema (and in the live database) before this phase - they were simply
 * never wired to any service or route. Same method shapes as the mock, now against Postgres.
 *
 * Utilization is still computed live from real PAID orders (never a stored running total, so it
 * can never drift from what was actually paid) - the one thing this migration deliberately keeps
 * unchanged from the mock's own design, since it was already correct. `committedAmount` (see the
 * schema comment on Budget) is a separate concern: it exists only for atomic budget *enforcement*
 * at purchase-request creation time (see reserveBudget/releaseBudget below and
 * procurement.service.ts#createPurchaseRequest), not for the utilization dashboard.
 */

export const DEFAULT_ALERT_THRESHOLDS = [70, 85, 100];

export interface NewBudgetInput {
  companyId: UUID;
  scope: BudgetScope;
  department?: string;
  costCenterId?: UUID;
  period: BudgetPeriod;
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

function toBudgetDto(b: {
  id: string;
  companyId: string;
  scope: BudgetScope;
  department: string | null;
  costCenterId: string | null;
  period: BudgetPeriod;
  year: number;
  month: number | null;
  amount: Prisma.Decimal | number;
}): Budget {
  return {
    id: b.id,
    companyId: b.companyId,
    scope: b.scope,
    department: b.department ?? undefined,
    costCenterId: b.costCenterId ?? undefined,
    period: b.period,
    year: b.year,
    month: b.month ?? undefined,
    amount: Number(b.amount),
  };
}

export async function listBudgets(companyId: UUID): Promise<ServiceResult<Budget[]>> {
  const budgets = await db.budget.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  return ok(budgets.map(toBudgetDto));
}

export async function createBudget(input: NewBudgetInput, actor: { id: string; name: string }): Promise<ServiceResult<Budget>> {
  if (input.amount <= 0) return fail('INVALID_AMOUNT', 'Set a budget amount greater than zero.');
  if (input.scope === 'DEPARTMENT' && !input.department?.trim()) return fail('MISSING_DEPARTMENT', 'Select a department for a department-scoped budget.');
  if (input.scope === 'COST_CENTER' && !input.costCenterId) return fail('MISSING_COST_CENTER', 'Select a cost center for a cost-center-scoped budget.');
  if (input.period === 'MONTHLY' && (!input.month || input.month < 1 || input.month > 12)) {
    return fail('INVALID_MONTH', 'Set a month between 1 and 12 for a monthly budget.');
  }

  const budget = await db.budget.create({
    data: {
      companyId: input.companyId,
      scope: input.scope,
      department: input.scope === 'DEPARTMENT' ? input.department?.trim() : undefined,
      costCenterId: input.scope === 'COST_CENTER' ? input.costCenterId : undefined,
      period: input.period,
      year: input.year,
      month: input.period === 'MONTHLY' ? input.month : undefined,
      amount: input.amount,
    },
  });

  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    companyId: input.companyId,
    action: 'BUDGET_CREATED',
    entityType: 'Budget',
    entityId: budget.id,
    newValue: { scope: budget.scope, amount: Number(budget.amount), period: budget.period, year: budget.year, month: budget.month },
  });

  return ok(toBudgetDto(budget));
}

export async function removeBudget(budgetId: UUID, companyId: UUID, actor: { id: string; name: string }): Promise<ServiceResult<void>> {
  const budget = await db.budget.findUnique({ where: { id: budgetId } });
  if (!budget || budget.companyId !== companyId) return fail('NOT_FOUND', 'That budget could not be found.');

  await db.budget.delete({ where: { id: budgetId } });
  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    companyId,
    action: 'BUDGET_REMOVED',
    entityType: 'Budget',
    entityId: budgetId,
    previousValue: { scope: budget.scope, amount: Number(budget.amount) },
  });
  return ok(undefined);
}

export async function listUtilization(companyId: UUID): Promise<ServiceResult<BudgetUtilization[]>> {
  const [budgets, orders, thresholds] = await Promise.all([
    db.budget.findMany({ where: { companyId } }),
    db.order.findMany({
      where: { companyId, paymentStatus: 'PAID' },
      select: { total: true, department: true, costCenterId: true, createdAt: true },
    }),
    getAlertThresholds(companyId),
  ]);
  const thresholdList = thresholds.ok ? thresholds.data : DEFAULT_ALERT_THRESHOLDS;

  const utilization = budgets.map((budget) => {
    const inPeriod = orders.filter((o) => {
      if (o.createdAt.getFullYear() !== budget.year) return false;
      if (budget.period === 'MONTHLY' && o.createdAt.getMonth() + 1 !== budget.month) return false;
      return true;
    });
    const scoped = inPeriod.filter((o) => {
      if (budget.scope === 'COMPANY') return true;
      if (budget.scope === 'DEPARTMENT') return o.department === budget.department;
      if (budget.scope === 'COST_CENTER') return o.costCenterId === budget.costCenterId;
      return false;
    });
    const spent = scoped.reduce((sum, o) => sum + Number(o.total), 0);
    const amount = Number(budget.amount);
    const percentUsed = amount > 0 ? Math.round((spent / amount) * 100) : 0;
    const alertLevel = [...thresholdList].sort((a, b) => b - a).find((t) => percentUsed >= t) ?? null;
    const label = budget.scope === 'COMPANY' ? 'Company-wide' : budget.scope === 'DEPARTMENT' ? (budget.department ?? 'Department') : 'Cost center';

    return { budget: toBudgetDto(budget), label, spent, remaining: amount - spent, percentUsed, alertLevel };
  });

  return ok(utilization);
}

export async function getAlertThresholds(companyId: UUID): Promise<ServiceResult<number[]>> {
  const row = await db.budgetAlertSettings.findUnique({ where: { companyId } });
  return ok(row?.thresholds ?? DEFAULT_ALERT_THRESHOLDS);
}

export async function setAlertThresholds(companyId: UUID, thresholds: number[], actor: { id: string; name: string }): Promise<ServiceResult<void>> {
  if (thresholds.length === 0 || thresholds.some((t) => t <= 0 || t > 200)) {
    return fail('INVALID_THRESHOLD', 'Thresholds must be between 1 and 200%.');
  }
  const sorted = [...thresholds].sort((a, b) => a - b);
  await db.budgetAlertSettings.upsert({
    where: { companyId },
    update: { thresholds: sorted },
    create: { companyId, thresholds: sorted },
  });
  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    companyId,
    action: 'BUDGET_ALERT_THRESHOLDS_UPDATED',
    entityType: 'BudgetAlertSettings',
    entityId: companyId,
    newValue: { thresholds: sorted },
  });
  return ok(undefined);
}

// ---- Budget enforcement (section 6/32) - called from procurement.service.ts#createPurchaseRequest ----

export interface ApplicableBudget {
  id: UUID;
  amount: number;
  committedAmount: number;
}

/** Resolves the single most specific budget a purchase request's scope/period would draw
 *  against - cost center, else department, else company-wide, for the request's own year/month
 *  (never a client-supplied one). A request only affects the most specific applicable budget, so
 *  it's never double-counted against, say, both its department's budget and the company-wide one
 *  at the same time. Returns null when no budget applies at all - an unconfigured scope/period
 *  is not a constraint, matching the mock's own "no budget = no limit" behavior. */
export async function findApplicableBudget(
  companyId: UUID,
  department: string | undefined,
  costCenterId: UUID | undefined,
  at: Date,
  client: Prisma.TransactionClient | PrismaClient = db,
): Promise<ApplicableBudget | null> {
  const year = at.getFullYear();
  const month = at.getMonth() + 1;

  const candidates: { scope: BudgetScope; where: Prisma.BudgetWhereInput }[] = [];
  if (costCenterId) candidates.push({ scope: 'COST_CENTER', where: { companyId, scope: 'COST_CENTER', costCenterId } });
  if (department) candidates.push({ scope: 'DEPARTMENT', where: { companyId, scope: 'DEPARTMENT', department } });
  candidates.push({ scope: 'COMPANY', where: { companyId, scope: 'COMPANY' } });

  for (const candidate of candidates) {
    // A MONTHLY budget for this exact year/month takes precedence over an ANNUAL one at the same
    // scope, if both happen to exist - the more specific period wins, mirroring how the utilization
    // dashboard already treats period as part of a budget's own identity, not a filter on top of it.
    const monthly = await client.budget.findFirst({ where: { ...candidate.where, period: 'MONTHLY', year, month } });
    if (monthly) return { id: monthly.id, amount: Number(monthly.amount), committedAmount: Number(monthly.committedAmount) };
    const annual = await client.budget.findFirst({ where: { ...candidate.where, period: 'ANNUAL', year } });
    if (annual) return { id: annual.id, amount: Number(annual.amount), committedAmount: Number(annual.committedAmount) };
  }

  return null;
}

/** Atomically reserves `amount` against a budget's committed total - an `UPDATE ... WHERE
 *  committedAmount + amount <= amount` (a conditional update, not a separate read-then-write),
 *  so two concurrent purchase requests racing the same budget can never both be admitted when
 *  combined they'd exceed it (section 31/32's concurrency requirement). The database's own
 *  row-level lock during the UPDATE is what serializes them - whichever transaction's UPDATE
 *  commits first shrinks the room left for the other's WHERE clause to still match. */
export async function reserveBudget(budgetId: UUID, amount: number, client: Prisma.TransactionClient): Promise<boolean> {
  const result = await client.$queryRaw<{ id: string }[]>`
    UPDATE "Budget"
    SET "committedAmount" = "committedAmount" + ${amount}
    WHERE "id" = ${budgetId} AND "committedAmount" + ${amount} <= "amount"
    RETURNING "id"
  `;
  return result.length === 1;
}

/** Releases a previously-reserved commitment (a purchase request that was rejected or
 *  cancelled after having reserved budget) - never lets a dead request's reservation
 *  permanently shrink the budget's available room. */
export async function releaseBudget(budgetId: UUID, amount: number, client: Prisma.TransactionClient | PrismaClient = db): Promise<void> {
  await client.$executeRaw`
    UPDATE "Budget"
    SET "committedAmount" = GREATEST("committedAmount" - ${amount}, 0)
    WHERE "id" = ${budgetId}
  `;
}
