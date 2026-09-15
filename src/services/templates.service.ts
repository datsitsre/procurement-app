import { apiRequest } from './base';
import type { ServiceResult, TenantContext, UUID } from '@/types/common';
import type { PurchaseTemplate, PurchaseTemplateItem } from '@/types/procurement';
import type { Role } from '@/config/rbac';

/** Real, database-backed (Phase 15). Calls the `/api/companies/[companyId]/purchase-templates*`
 *  backend instead of `localStorage` - `callerRole` is accepted only because every existing call
 *  site already passes it; the server derives the caller's own role/tenant from the session. */

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

class ApiTemplatesService implements TemplatesService {
  async listTemplates(companyId: UUID): Promise<ServiceResult<PurchaseTemplate[]>> {
    return apiRequest<PurchaseTemplate[]>(`/api/companies/${companyId}/purchase-templates`);
  }

  async createTemplate(input: NewTemplateInput): Promise<ServiceResult<PurchaseTemplate>> {
    return apiRequest<PurchaseTemplate>(`/api/companies/${input.companyId}/purchase-templates`, {
      method: 'POST',
      body: JSON.stringify({ name: input.name, items: input.items }),
    });
  }

  async removeTemplate(templateId: UUID, _callerRole: Role, caller: TenantContext): Promise<ServiceResult<void>> {
    const companyId = caller.companyId;
    if (!companyId) return { ok: false, error: { code: 'NOT_FOUND', message: 'That template could not be found.' } };
    const result = await apiRequest<{ ok: true }>(`/api/companies/${companyId}/purchase-templates/${templateId}`, { method: 'DELETE' });
    return result.ok ? { ok: true, data: undefined } : result;
  }
}

export const templatesService: TemplatesService = new ApiTemplatesService();
