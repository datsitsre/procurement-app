import { assertPermission, delay, fail, ok, ownsRecord } from './base';
import { catalogService } from './catalog.service';
import { procurementService } from './procurement.service';
import { Permission, type Role } from '@/config/rbac';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { PurchaseTemplateItem, RecurringFrequency, RecurringPurchase } from '@/types/procurement';

const STORE_KEY = 'procurement.recurring-purchases.v1.list';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function readList(): RecurringPurchase[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as RecurringPurchase[];
  } catch {
    return [];
  }
}

function writeList(list: RecurringPurchase[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
}

function advance(from: Date, frequency: RecurringFrequency, customIntervalDays?: number): Date {
  const next = new Date(from);
  if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
  else if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  else if (frequency === 'QUARTERLY') next.setMonth(next.getMonth() + 3);
  else next.setDate(next.getDate() + Math.max(1, customIntervalDays ?? 30));
  return next;
}

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
  /**
   * Submits a purchase request for every active schedule whose `nextRunAt` has passed, then
   * advances it to its next occurrence (section 11.2). There is no real background job runner
   * in this build (that's Phase 36's job) - this is called from the recurring-purchases page on
   * load as a deliberate, visible stand-in for a cron job, the same way NegotiationThread's
   * canned supplier reply stands in for a real counterpart. Each request goes through
   * procurement.service.ts#createPurchaseRequest exactly like a manually-submitted one - the
   * company's real approval rules and spending limits still apply; a recurring purchase never
   * bypasses either. Every item's price is re-checked against the live catalog before the
   * request is built, the same "never silently use old pricing" rule reordering follows.
   */
  runDue(companyId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<RunDueOutcome>>;
}

class MockRecurringService implements RecurringService {
  async listRecurringPurchases(companyId: UUID): Promise<ServiceResult<RecurringPurchase[]>> {
    await delay(200);
    return ok(readList().filter((r) => r.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async createRecurringPurchase(input: NewRecurringPurchaseInput, callerRole: Role): Promise<ServiceResult<RecurringPurchase>> {
    await delay(300);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_CREATE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!input.name.trim()) return fail('EMPTY', 'Give this recurring purchase a name.');
    if (input.items.length === 0) return fail('EMPTY', 'Add at least one product.');

    const now = new Date();
    const schedule: RecurringPurchase = {
      id: newId('recur'),
      companyId: input.companyId,
      name: input.name.trim(),
      items: input.items,
      frequency: input.frequency,
      customIntervalDays: input.customIntervalDays,
      requesterUserId: input.requesterUserId,
      requesterName: input.requesterName,
      department: input.department,
      costCenterId: input.costCenterId,
      active: true,
      nextRunAt: advance(now, input.frequency, input.customIntervalDays).toISOString(),
      createdPurchaseRequestIds: [],
      createdAt: now.toISOString(),
    };
    writeList([...readList(), schedule]);
    return ok(schedule);
  }

  async setActive(id: UUID, active: boolean, callerRole: Role, caller: TenantContext): Promise<ServiceResult<RecurringPurchase>> {
    await delay(200);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_CREATE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const list = readList();
    const schedule = list.find((r) => r.id === id);
    if (!schedule || !ownsRecord(caller, schedule.companyId)) return fail('NOT_FOUND', 'That recurring purchase could not be found.');

    const updated = { ...schedule, active };
    writeList(list.map((r) => (r.id === id ? updated : r)));
    return ok(updated);
  }

  async removeRecurringPurchase(id: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(200);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_CREATE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const list = readList();
    const schedule = list.find((r) => r.id === id);
    if (!schedule || !ownsRecord(caller, schedule.companyId)) return fail('NOT_FOUND', 'That recurring purchase could not be found.');

    writeList(list.filter((r) => r.id !== id));
    return ok(undefined);
  }

  async runDue(companyId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<RunDueOutcome>> {
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_CREATE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!ownsRecord(caller, companyId)) return fail('NOT_FOUND', 'That company could not be found.');

    const list = readList();
    const now = new Date();
    const due = list.filter((r) => r.companyId === companyId && r.active && new Date(r.nextRunAt) <= now);

    const warnings: string[] = [];
    const createdPurchaseRequestIds: UUID[] = [];

    for (const schedule of due) {
      let createdForThisSchedule: UUID | null = null;
      const items = [];
      for (const line of schedule.items) {
        const productResult = await catalogService.getProductById(line.productId);
        if (!productResult.ok || productResult.data.moderationStatus !== 'PUBLISHED') {
          warnings.push(`${schedule.name}: ${line.productName} is no longer available and was skipped this run.`);
          continue;
        }
        const product = productResult.data;
        const supplier = catalogService.getSupplierById(product.supplierId);
        items.push({
          id: newId('pri'),
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
      } else {
        const result = await procurementService.createPurchaseRequest(
          {
            companyId,
            requesterUserId: schedule.requesterUserId,
            requesterName: schedule.requesterName,
            department: schedule.department,
            costCenterId: schedule.costCenterId,
            items,
            reason: `Recurring purchase: ${schedule.name}`,
          },
          callerRole,
        );
        if (result.ok) {
          createdForThisSchedule = result.data.id;
          createdPurchaseRequestIds.push(result.data.id);
        } else {
          warnings.push(`${schedule.name}: ${result.error.message}`);
        }
      }

      const updated: RecurringPurchase = {
        ...schedule,
        lastRunAt: now.toISOString(),
        nextRunAt: advance(now, schedule.frequency, schedule.customIntervalDays).toISOString(),
        createdPurchaseRequestIds: createdForThisSchedule
          ? [createdForThisSchedule, ...schedule.createdPurchaseRequestIds]
          : schedule.createdPurchaseRequestIds,
      };
      writeList(readList().map((r) => (r.id === schedule.id ? updated : r)));
    }

    return ok({ ranCount: due.length, createdPurchaseRequestIds, warnings });
  }
}

export const recurringService: RecurringService = new MockRecurringService();
