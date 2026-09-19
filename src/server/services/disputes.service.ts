import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toDisputeDto } from '@/server/dto/orders';
import { recordAudit } from './audit.service';
import type { ServiceResult, UUID } from '@/types/common';
import type { Dispute } from '@/types/orders';
import type { Prisma } from '@prisma/client';

/** The real, database-backed counterpart to src/services/disputes.service.ts's mock (Phase 14,
 *  Stage 7) - a buyer's report of an issue with a delivered order, resolved by a platform admin. */

const DISPUTE_INCLUDE = { order: true } satisfies Prisma.DisputeInclude;

export async function listDisputes(companyId: UUID): Promise<ServiceResult<Dispute[]>> {
  const disputes = await db.dispute.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: DISPUTE_INCLUDE });
  return ok(disputes.map(toDisputeDto));
}

export async function listDisputesForSupplier(supplierId: UUID): Promise<ServiceResult<Dispute[]>> {
  const disputes = await db.dispute.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, include: DISPUTE_INCLUDE });
  return ok(disputes.map(toDisputeDto));
}

export async function getDisputeForOrder(orderId: UUID): Promise<ServiceResult<Dispute | null>> {
  const dispute = await db.dispute.findFirst({ where: { orderId }, include: DISPUTE_INCLUDE });
  return ok(dispute ? toDisputeDto(dispute) : null);
}

/** Every dispute across every company - the admin dispute queue (section 46/49). */
export async function listAllDisputes(): Promise<ServiceResult<Dispute[]>> {
  const disputes = await db.dispute.findMany({ orderBy: { createdAt: 'desc' }, include: DISPUTE_INCLUDE });
  return ok(disputes.map(toDisputeDto));
}

export interface NewDisputeInput {
  orderId: UUID;
  companyId: UUID;
  supplierId: UUID;
  reason: string;
  description: string;
}

/** `companyId`/`supplierId` are the caller's already-verified order's own fields (the route looks
 *  the order up and checks ownership before calling this) - never trusted directly from the
 *  client, so a buyer can't fabricate a dispute that claims to be about an order they don't own. */
export async function createDispute(input: NewDisputeInput): Promise<ServiceResult<Dispute>> {
  if (!input.reason.trim() || !input.description.trim()) {
    return fail('EMPTY', 'Describe the issue before submitting.');
  }

  const dispute = await db.dispute.create({
    data: {
      orderId: input.orderId,
      companyId: input.companyId,
      supplierId: input.supplierId,
      reason: input.reason,
      description: input.description,
    },
    include: DISPUTE_INCLUDE,
  });
  return ok(toDisputeDto(dispute));
}

/** A platform admin closes out a dispute - RESOLVED_REFUND also marks the underlying order's
 *  payment REFUNDED (via orders.service, imported lazily to avoid a circular import). */
export async function resolveDispute(
  disputeId: UUID,
  decision: 'RESOLVED_REFUND' | 'RESOLVED_REJECTED',
  note: string,
  actorId: UUID,
  actorName: string,
): Promise<ServiceResult<Dispute>> {
  const dispute = await db.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) return fail('NOT_FOUND', 'That dispute could not be found.');
  if (dispute.status.startsWith('RESOLVED') || dispute.status === 'CLOSED') {
    return fail('ALREADY_RESOLVED', 'This dispute has already been resolved.');
  }

  const updated = await db.dispute.update({
    where: { id: disputeId },
    data: { status: decision, resolutionNote: note, resolvedAt: new Date() },
    include: DISPUTE_INCLUDE,
  });

  if (decision === 'RESOLVED_REFUND') {
    const { markRefunded } = await import('./orders.service');
    await markRefunded(dispute.orderId);
  }

  await recordAudit({
    actorId,
    actorName,
    action: 'DISPUTE_RESOLVED',
    entityType: 'Dispute',
    entityId: disputeId,
    previousValue: { status: dispute.status },
    newValue: { status: decision, note },
  });

  return ok(toDisputeDto(updated));
}
