import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { recordAudit } from '@/server/services/audit.service';
import type { ServiceResult, UUID } from '@/types/common';
import type { PurchaseTemplate, PurchaseTemplateItem } from '@/types/procurement';

/**
 * The real, database-backed counterpart to src/services/templates.service.ts's localStorage mock
 * (Phase 15). `PurchaseTemplate`/`PurchaseTemplateItem` already existed in the schema (and the
 * live database) before this phase - never wired to a service or route. Deliberately stores no
 * price on any item - a template is a reusable *list*, never a snapshot of what things cost when
 * it was saved; applying one always goes back through the real catalog (adding to a cart, then
 * checkout) for current price/availability/MOQ, the same "never trust old pricing" rule
 * reordering a past order already follows (features/orders/reorder.ts).
 */

function toTemplateDto(t: { id: string; companyId: string; name: string; createdByUserId: string; createdAt: Date; items: { productId: string; productName: string; quantity: number }[] }): PurchaseTemplate {
  return {
    id: t.id,
    companyId: t.companyId,
    name: t.name,
    createdByUserId: t.createdByUserId,
    createdAt: t.createdAt.toISOString(),
    items: t.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })),
  };
}

const TEMPLATE_INCLUDE = { items: true } as const;

export async function listTemplates(companyId: UUID): Promise<ServiceResult<PurchaseTemplate[]>> {
  const templates = await db.purchaseTemplate.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, include: TEMPLATE_INCLUDE });
  return ok(templates.map(toTemplateDto));
}

export interface NewTemplateInput {
  companyId: UUID;
  name: string;
  items: PurchaseTemplateItem[];
  createdByUserId: UUID;
}

export async function createTemplate(input: NewTemplateInput, actor: { id: string; name: string }): Promise<ServiceResult<PurchaseTemplate>> {
  if (!input.name.trim()) return fail('EMPTY', 'Give the template a name.');
  if (input.items.length === 0) return fail('EMPTY', 'A template needs at least one product.');

  const template = await db.purchaseTemplate.create({
    data: {
      companyId: input.companyId,
      name: input.name.trim(),
      createdByUserId: input.createdByUserId,
      items: { create: input.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })) },
    },
    include: TEMPLATE_INCLUDE,
  });

  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    companyId: input.companyId,
    action: 'PURCHASE_TEMPLATE_CREATED',
    entityType: 'PurchaseTemplate',
    entityId: template.id,
    newValue: { name: template.name, itemCount: template.items.length },
  });

  return ok(toTemplateDto(template));
}

export async function removeTemplate(templateId: UUID, companyId: UUID, actor: { id: string; name: string }): Promise<ServiceResult<void>> {
  const template = await db.purchaseTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.companyId !== companyId) return fail('NOT_FOUND', 'That template could not be found.');

  await db.purchaseTemplate.delete({ where: { id: templateId } });
  await recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    companyId,
    action: 'PURCHASE_TEMPLATE_REMOVED',
    entityType: 'PurchaseTemplate',
    entityId: templateId,
    previousValue: { name: template.name },
  });
  return ok(undefined);
}
