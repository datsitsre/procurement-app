import { assertPermission, delay, fail, ok, ownsRecord } from './base';
import { Permission, type Role } from '@/config/rbac';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { PurchaseTemplate, PurchaseTemplateItem } from '@/types/procurement';

const TEMPLATE_STORE_KEY = 'procurement.purchase-templates.v1.list';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function readList(): PurchaseTemplate[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(TEMPLATE_STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PurchaseTemplate[];
  } catch {
    return [];
  }
}

function writeList(list: PurchaseTemplate[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TEMPLATE_STORE_KEY, JSON.stringify(list));
}

export interface NewTemplateInput {
  companyId: UUID;
  name: string;
  items: PurchaseTemplateItem[];
  createdByUserId: UUID;
}

export interface TemplatesService {
  listTemplates(companyId: UUID): Promise<ServiceResult<PurchaseTemplate[]>>;
  createTemplate(input: NewTemplateInput, callerRole: Role): Promise<ServiceResult<PurchaseTemplate>>;
  removeTemplate(templateId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>>;
}

class MockTemplatesService implements TemplatesService {
  async listTemplates(companyId: UUID): Promise<ServiceResult<PurchaseTemplate[]>> {
    await delay(200);
    return ok(readList().filter((t) => t.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async createTemplate(input: NewTemplateInput, callerRole: Role): Promise<ServiceResult<PurchaseTemplate>> {
    await delay(250);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_CREATE);
    if (permissionError) return fail(permissionError.code, permissionError.message);
    if (!input.name.trim()) return fail('EMPTY', 'Give the template a name.');
    if (input.items.length === 0) return fail('EMPTY', 'A template needs at least one product.');

    const template: PurchaseTemplate = {
      id: newId('tpl'),
      companyId: input.companyId,
      name: input.name.trim(),
      items: input.items,
      createdByUserId: input.createdByUserId,
      createdAt: new Date().toISOString(),
    };
    writeList([...readList(), template]);
    return ok(template);
  }

  async removeTemplate(templateId: UUID, callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    await delay(200);
    const permissionError = assertPermission(callerRole, Permission.PURCHASE_REQUEST_CREATE);
    if (permissionError) return fail(permissionError.code, permissionError.message);

    const list = readList();
    const template = list.find((t) => t.id === templateId);
    if (!template || !ownsRecord(caller, template.companyId)) return fail('NOT_FOUND', 'That template could not be found.');

    writeList(list.filter((t) => t.id !== templateId));
    return ok(undefined);
  }
}

export const templatesService: TemplatesService = new MockTemplatesService();
