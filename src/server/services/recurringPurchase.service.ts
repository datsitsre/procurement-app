import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { recordAudit } from '@/server/services/audit.service';
import { getProductById } from '@/server/services/catalog.service';
import { createPurchaseRequest } from '@/server/services/procurement.service';
import { notifyUser } from '@/server/services/notification.service';
import type { ServiceResult, UUID } from '@/types/common';
import type { PurchaseTemplateItem, RecurringFrequency, RecurringPurchase } from '@/types/procurement';

/**
 * The real, database-backed counterpart to src/services/recurring.service.ts's localStorage mock
 * (Phase 15). The `RecurringPurchase`/`RecurringPurchaseItem`/`RecurringPurchaseRun` Prisma
 * models already existed in the schema (and the live database) before this phase - never wired
 * to a service, route, or real scheduler.
 *
 * The most important architectural change from the mock: `runDueSchedules` below is no longer
 * something the browser triggers on page load ("a deliberate, visible stand-in for a cron job",
 * per the mock's own comment) - it's called from POST /api/cron/recurring-purchase-sweep,
 * authenticated the same way every other cron sweep in this app is (requireCronSecret), on a
 * real external schedule. The browser may still ask for it to run *now* (a "Run due schedules"
 * button calling an authenticated company-scoped route), but the execution itself always happens
 * server-side, through the same function the cron route calls - the browser never computes or
 * writes the result itself.
 */

function toRecurringPurchaseDto(r: {
  id: string;
  companyId: string;
  name: string;
  frequency: RecurringFrequency;
  customIntervalDays: number | null;
  requesterUserId: string;
  requester?: { name: string } | null;
  department: string | null;
  costCenterId: string | null;
  active: boolean;
  nextRunAt: Date;
  lastRunAt: Date | null;
  createdAt: Date;
  items: { productId: string; productName: string; quantity: number }[];
  createdPurchaseRequestIds: { purchaseRequestId: string | null }[];
}): RecurringPurchase {
  return {
    id: r.id,
    companyId: r.companyId,
    name: r.name,
    items: r.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })),
    frequency: r.frequency,
    customIntervalDays: r.customIntervalDays ?? undefined,
    requesterUserId: r.requesterUserId,
    requesterName: r.requester?.name ?? 'Unknown',
    department: r.department ?? undefined,
    costCenterId: r.costCenterId ?? undefined,
    active: r.active,
    nextRunAt: r.nextRunAt.toISOString(),
    lastRunAt: r.lastRunAt?.toISOString(),
    createdPurchaseRequestIds: r.createdPurchaseRequestIds.map((run) => run.purchaseRequestId).filter((id): id is string => id !== null),
    createdAt: r.createdAt.toISOString(),
  };
}

const RECURRING_INCLUDE = {
  requester: { select: { name: true } },
  items: true,
  createdPurchaseRequestIds: { orderBy: { ranAt: 'desc' as const } },
} as const;

export async function listRecurringPurchases(companyId: UUID): Promise<ServiceResult<RecurringPurchase[]>> {
  const schedules = await db.recurringPurchase.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: RECURRING_INCLUDE });
  return ok(schedules.map(toRecurringPurchaseDto));
}

/** Advances `from` by one occurrence of `frequency` - the same "skip missed occurrences, run
 *  once, resume from the next real future occurrence" policy `advanceToFuture` below applies
 *  repeatedly when the scheduler was offline across more than one occurrence (section 23). */
function advanceOnce(from: Date, frequency: RecurringFrequency, customIntervalDays?: number | null): Date {
  const next = new Date(from);
  if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
  else if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  else if (frequency === 'QUARTERLY') next.setMonth(next.getMonth() + 3);
  else next.setDate(next.getDate() + Math.max(1, customIntervalDays ?? 30));
  return next;
}

/** Missed-schedule policy (section 23): if the scheduler was offline across more than one
 *  occurrence (e.g. a weekly schedule untouched for a month), this fast-forwards `nextRunAt`
 *  straight to the next occurrence that is actually still in the future, rather than either (a)
 *  silently creating one purchase request per missed occurrence (a backlog no one asked for), or
 *  (b) leaving `nextRunAt` in the past so the very next sweep immediately treats it as due again
 *  and creates a second request moments later. Exactly one purchase request is created per sweep
 *  per schedule, regardless of how many occurrences were missed. */
function advanceToFuture(from: Date, frequency: RecurringFrequency, customIntervalDays: number | null, now: Date): Date {
  let next = advanceOnce(from, frequency, customIntervalDays);
  let guard = 0;
  while (next <= now && guard < 1000) {
    next = advanceOnce(next, frequency, customIntervalDays);
    guard += 1;
  }
  return next;
}

export interface NewRecurringPurchaseInput {
  companyId: UUID;
  name: string;
  items: PurchaseTemplateItem[];
  frequency: RecurringFrequency;
  customIntervalDays?: number;
  requesterUserId: UUID;
  department?: string;
  costCenterId?: UUID;
}

export async function createRecurringPurchase(input: NewRecurringPurchaseInput): Promise<ServiceResult<RecurringPurchase>> {
  if (!input.name.trim()) return fail('EMPTY', 'Give this recurring purchase a name.');
  if (input.items.length === 0) return fail('EMPTY', 'Add at least one product.');

  const now = new Date();
  const schedule = await db.recurringPurchase.create({
    data: {
      companyId: input.companyId,
      name: input.name.trim(),
      frequency: input.frequency,
      customIntervalDays: input.frequency === 'CUSTOM' ? input.customIntervalDays : undefined,
      requesterUserId: input.requesterUserId,
      department: input.department,
      costCenterId: input.costCenterId,
      active: true,
      nextRunAt: advanceOnce(now, input.frequency, input.customIntervalDays),
      items: { create: input.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })) },
    },
    include: RECURRING_INCLUDE,
  });

  await recordAudit({
    actorId: input.requesterUserId,
    actorName: schedule.requester?.name ?? 'Unknown',
    companyId: input.companyId,
    action: 'RECURRING_PURCHASE_CREATED',
    entityType: 'RecurringPurchase',
    entityId: schedule.id,
    newValue: { name: schedule.name, frequency: schedule.frequency },
  });

  return ok(toRecurringPurchaseDto(schedule));
}

export async function setActive(id: UUID, companyId: UUID, active: boolean, actor: { id: string; name: string }): Promise<ServiceResult<RecurringPurchase>> {
  const schedule = await db.recurringPurchase.findUnique({ where: { id } });
  if (!schedule || schedule.companyId !== companyId) return fail('NOT_FOUND', 'That recurring purchase could not be found.');

  const updated = await db.recurringPurchase.update({ where: { id }, data: { active }, include: RECURRING_INCLUDE });
  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    companyId,
    action: active ? 'RECURRING_PURCHASE_RESUMED' : 'RECURRING_PURCHASE_PAUSED',
    entityType: 'RecurringPurchase',
    entityId: id,
  });
  return ok(toRecurringPurchaseDto(updated));
}

export async function removeRecurringPurchase(id: UUID, companyId: UUID, actor: { id: string; name: string }): Promise<ServiceResult<void>> {
  const schedule = await db.recurringPurchase.findUnique({ where: { id } });
  if (!schedule || schedule.companyId !== companyId) return fail('NOT_FOUND', 'That recurring purchase could not be found.');

  await db.recurringPurchase.delete({ where: { id } });
  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    companyId,
    action: 'RECURRING_PURCHASE_CANCELLED',
    entityType: 'RecurringPurchase',
    entityId: id,
    previousValue: { name: schedule.name },
  });
  return ok(undefined);
}

export interface RunDueOutcome {
  ranCount: number;
  createdPurchaseRequestIds: UUID[];
  warnings: string[];
}

/**
 * Runs every active, due schedule - for a single company (the "Run due schedules now" button) or
 * across every company at once (the real cron sweep). Idempotent (section 22): claiming an
 * occurrence is an atomic conditional update (`nextRunAt` must still equal the exact due value
 * this call read), the same pattern this app already uses for quote acceptance and approval
 * decisions - two overlapping sweeps racing the same due schedule can both attempt the claim, but
 * only one can ever win it, so at most one purchase request is ever created per occurrence. A
 * `RecurringPurchaseRun` unique constraint on (recurringId, occurrenceAt) is a second, defense-
 * in-depth backstop against the same duplication.
 *
 * Never bypasses procurement controls (section 20): every generated request goes through the
 * exact same createPurchaseRequest as a manually-submitted one - the company's real approval
 * rules, spending limits, and budget enforcement all still apply. Every item's price/availability
 * is re-checked against the live catalog immediately before building the request; a schedule
 * whose products are no longer available skips just that item (or the whole run, if none are)
 * rather than using stale data.
 */
export async function runDueSchedules(scope?: { companyId?: string }): Promise<RunDueOutcome> {
  const now = new Date();
  const due = await db.recurringPurchase.findMany({
    where: { active: true, nextRunAt: { lte: now }, ...(scope?.companyId ? { companyId: scope.companyId } : {}) },
    include: { items: true, requester: { select: { name: true } } },
  });

  const warnings: string[] = [];
  const createdPurchaseRequestIds: UUID[] = [];
  let ranCount = 0;

  for (const schedule of due) {
    const occurrenceAt = schedule.nextRunAt;
    const nextOccurrence = advanceToFuture(occurrenceAt, schedule.frequency, schedule.customIntervalDays, now);

    // Atomic claim - the WHERE clause pins the exact `nextRunAt` this loop iteration read, so a
    // concurrent sweep that already advanced it (or paused the schedule) can never also claim it.
    const { count } = await db.recurringPurchase.updateMany({
      where: { id: schedule.id, nextRunAt: occurrenceAt, active: true },
      data: { nextRunAt: nextOccurrence, lastRunAt: now },
    });
    if (count === 0) continue;
    ranCount += 1;

    const items: { id: string; productId: string; productName: string; supplierId: string; supplierName: string; quantity: number; unitPrice: number }[] = [];
    for (const line of schedule.items) {
      const productResult = await getProductById(line.productId);
      if (!productResult.ok || productResult.data.moderationStatus !== 'PUBLISHED') {
        warnings.push(`${schedule.name}: ${line.productName} is no longer available and was skipped this run.`);
        continue;
      }
      const product = productResult.data;
      if (line.quantity < product.moq) {
        warnings.push(`${schedule.name}: ${line.productName} now requires a minimum order quantity of ${product.moq} (schedule has ${line.quantity}) and was skipped this run.`);
        continue;
      }
      const supplier = await db.supplierProfile.findUnique({ where: { id: product.supplierId }, select: { name: true } });
      items.push({
        id: `pri-${crypto.randomUUID()}`,
        productId: product.id,
        productName: product.name,
        supplierId: product.supplierId,
        supplierName: supplier?.name ?? 'Supplier',
        quantity: line.quantity,
        unitPrice: product.basePrice,
      });
    }

    if (items.length === 0) {
      warnings.push(`${schedule.name}: none of its products are available - no request was created this run.`);
      await db.recurringPurchaseRun.create({
        data: { recurringId: schedule.id, occurrenceAt, status: 'SKIPPED', failureReason: 'No items available' },
      });
      continue;
    }

    const result = await createPurchaseRequest({
      companyId: schedule.companyId,
      requesterUserId: schedule.requesterUserId,
      department: schedule.department ?? undefined,
      costCenterId: schedule.costCenterId ?? undefined,
      items,
      reason: `Recurring purchase: ${schedule.name}`,
    });

    if (result.ok) {
      createdPurchaseRequestIds.push(result.data.id);
      await db.recurringPurchaseRun.create({
        data: { recurringId: schedule.id, purchaseRequestId: result.data.id, occurrenceAt, status: 'SUCCEEDED' },
      });
      await notifyUser(schedule.requesterUserId, {
        type: 'RECURRING_PURCHASE_GENERATED',
        title: `Recurring purchase generated: ${schedule.name}`,
        body: `A new purchase request (${result.data.reference}) was created from your "${schedule.name}" schedule.`,
        entityId: result.data.id,
        entityHref: `/purchase-requests/${result.data.id}`,
      });
    } else {
      warnings.push(`${schedule.name}: ${result.error.message}`);
      // Records the failure without ever creating a duplicate request for this occurrence
      // (section 26) - the occurrence is still consumed (nextRunAt already advanced above), so a
      // recurring, unfixable failure (e.g. a permanently-exceeded budget) surfaces once per real
      // occurrence instead of being silently retried into a tight failure loop.
      await db.recurringPurchaseRun.create({
        data: { recurringId: schedule.id, occurrenceAt, status: 'FAILED', failureReason: result.error.message },
      });
      await notifyUser(schedule.requesterUserId, {
        type: 'RECURRING_PURCHASE_FAILED',
        title: `Recurring purchase failed: ${schedule.name}`,
        body: `Your "${schedule.name}" schedule could not create a purchase request this run: ${result.error.message}`,
        entityId: schedule.id,
        entityHref: '/purchase-requests/recurring',
      });
    }
  }

  return { ranCount, createdPurchaseRequestIds, warnings };
}
