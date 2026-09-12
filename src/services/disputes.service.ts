import { assertPermission, delay, fail, ok } from './base';
import { auditLogService } from './audit-log.service';
import { demoDisputes } from '@/lib/demo-data/disputes';
import { Permission, type Role } from '@/config/rbac';
import type { ServiceResult, UUID } from '@/types/common';
import type { Dispute } from '@/types/orders';
import type { Actor } from './catalog.service';

const DISPUTE_STORE_KEY = 'platform.disputes.v1';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

/** Overrides keyed by dispute id - lets a resolution update a *seeded* demo dispute in place,
 *  the same pattern every other mutable mock resource in this app uses. */
function readOverrides(): Record<UUID, Dispute> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(DISPUTE_STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<UUID, Dispute>;
  } catch {
    return {};
  }
}

function writeOverride(dispute: Dispute) {
  if (typeof window === 'undefined') return;
  const store = readOverrides();
  store[dispute.id] = dispute;
  window.localStorage.setItem(DISPUTE_STORE_KEY, JSON.stringify(store));
}

function readCreated(): Dispute[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(`${DISPUTE_STORE_KEY}.list`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Dispute[];
  } catch {
    return [];
  }
}

function appendCreated(dispute: Dispute) {
  if (typeof window === 'undefined') return;
  const list = readCreated();
  list.push(dispute);
  window.localStorage.setItem(`${DISPUTE_STORE_KEY}.list`, JSON.stringify(list));
}

function allDisputes(): Dispute[] {
  const overrides = readOverrides();
  const seeded = demoDisputes.map((d) => overrides[d.id] ?? d);
  const created = readCreated().map((d) => overrides[d.id] ?? d);
  return [...seeded, ...created];
}

export interface NewDisputeInput {
  orderId: UUID;
  orderReference: string;
  companyId: UUID;
  supplierId: UUID;
  reason: string;
  description: string;
}

export interface DisputesService {
  listDisputes(companyId: UUID): Promise<ServiceResult<Dispute[]>>;
  listDisputesForSupplier(supplierId: UUID): Promise<ServiceResult<Dispute[]>>;
  getDisputeForOrder(orderId: UUID): Promise<ServiceResult<Dispute | null>>;
  /** Every dispute across every company - the admin dispute queue (section 46/49). */
  listAllDisputes(): Promise<ServiceResult<Dispute[]>>;
  /** A buyer reports an issue with a delivered order (section 46). */
  createDispute(input: NewDisputeInput): Promise<ServiceResult<Dispute>>;
  /** A platform admin closes out a dispute - RESOLVED_REFUND also marks the underlying order's
   *  payment REFUNDED (via orders.service, imported lazily to avoid a circular import). */
  resolveDispute(
    disputeId: UUID,
    decision: 'RESOLVED_REFUND' | 'RESOLVED_REJECTED',
    note: string,
    callerRole: Role,
    actor: Actor,
  ): Promise<ServiceResult<Dispute>>;
}

class MockDisputesService implements DisputesService {
  async listDisputes(companyId: UUID): Promise<ServiceResult<Dispute[]>> {
    await delay(250);
    return ok(allDisputes().filter((d) => d.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async listDisputesForSupplier(supplierId: UUID): Promise<ServiceResult<Dispute[]>> {
    await delay(250);
    return ok(allDisputes().filter((d) => d.supplierId === supplierId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async getDisputeForOrder(orderId: UUID): Promise<ServiceResult<Dispute | null>> {
    await delay(150);
    return ok(allDisputes().find((d) => d.orderId === orderId) ?? null);
  }

  async listAllDisputes(): Promise<ServiceResult<Dispute[]>> {
    await delay(250);
    return ok(allDisputes().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async createDispute(input: NewDisputeInput): Promise<ServiceResult<Dispute>> {
    await delay(350);
    if (!input.reason.trim() || !input.description.trim()) {
      return fail('EMPTY', 'Describe the issue before submitting.');
    }

    const dispute: Dispute = {
      id: newId('dispute'),
      orderId: input.orderId,
      orderReference: input.orderReference,
      companyId: input.companyId,
      supplierId: input.supplierId,
      reason: input.reason,
      description: input.description,
      evidenceUrls: [],
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };
    appendCreated(dispute);
    return ok(dispute);
  }

  async resolveDispute(
    disputeId: UUID,
    decision: 'RESOLVED_REFUND' | 'RESOLVED_REJECTED',
    note: string,
    callerRole: Role,
    actor: Actor,
  ): Promise<ServiceResult<Dispute>> {
    await delay(350);
    const permissionError = assertPermission(callerRole, Permission.PLATFORM_MANAGE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const dispute = allDisputes().find((d) => d.id === disputeId);
    if (!dispute) return fail('NOT_FOUND', 'That dispute could not be found.');
    if (dispute.status.startsWith('RESOLVED') || dispute.status === 'CLOSED') {
      return fail('ALREADY_RESOLVED', 'This dispute has already been resolved.');
    }

    const updated: Dispute = { ...dispute, status: decision, resolutionNote: note, resolvedAt: new Date().toISOString() };
    writeOverride(updated);

    if (decision === 'RESOLVED_REFUND') {
      const { ordersService } = await import('./orders.service');
      await ordersService.markRefunded(dispute.orderId);
    }

    auditLogService.record({
      actorId: actor.id,
      actorName: actor.name,
      action: 'DISPUTE_RESOLVED',
      entityType: 'Dispute',
      entityId: disputeId,
      previousValue: { status: dispute.status },
      newValue: { status: decision, note },
    });

    return ok(updated);
  }
}

export const disputesService: DisputesService = new MockDisputesService();
