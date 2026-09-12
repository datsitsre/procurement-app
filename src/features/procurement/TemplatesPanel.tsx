'use client';

import { useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { templatesService } from '@/services/templates.service';
import { addLinesToCart } from '@/features/orders/reorder';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { CartLine } from '@/hooks/useCart';
import type { PurchaseTemplate } from '@/types/procurement';
import type { Role } from '@/config/rbac';
import type { TenantContext } from '@/types/common';

export interface TemplatesPanelProps {
  companyId: string;
  userId: string;
  callerRole: Role;
  tenant: TenantContext;
  /** The current cart's lines, so "Save as template" has something to save - undefined (or an
   *  empty cart) simply hides that action, since there'd be nothing to save. */
  currentLines?: CartLine[];
  onApplied: (warnings: string[]) => void;
}

/** Purchase templates (section 11.0) - a saved, reusable list of products ("Office Setup
 *  Package") a buyer can load back into their cart in one click ("Order again") instead of
 *  re-adding every line by hand. Shown on the cart page in both the empty and non-empty states. */
export function TemplatesPanel({ companyId, userId, callerRole, tenant, currentLines, onApplied }: TemplatesPanelProps) {
  const { data: templates, reload } = useAsyncData<PurchaseTemplate[]>(companyId, () => templatesService.listTemplates(companyId));
  const [saving, setSaving] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function saveTemplate() {
    if (!currentLines || currentLines.length === 0) return;
    setSaving(true);
    setError(null);
    const result = await templatesService.createTemplate(
      {
        companyId,
        name,
        createdByUserId: userId,
        items: currentLines.map((l) => ({ productId: l.product.id, productName: l.product.name, quantity: l.item.quantity })),
      },
      callerRole,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setName('');
    setShowSaveForm(false);
    reload();
  }

  async function applyTemplate(template: PurchaseTemplate) {
    setApplyingId(template.id);
    const outcome = await addLinesToCart(
      template.items.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })),
      companyId,
    );
    setApplyingId(null);
    onApplied(outcome.warnings);
  }

  async function removeTemplate(templateId: string) {
    await templatesService.removeTemplate(templateId, callerRole, tenant);
    reload();
  }

  const hasCart = !!currentLines && currentLines.length > 0;

  if (templates === null) return null;
  if (templates.length === 0 && !hasCart) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Bookmark className="h-4 w-4" aria-hidden="true" />
          Purchase templates
        </p>
        {hasCart && (
          <Button variant="outline" size="sm" onClick={() => setShowSaveForm((v) => !v)}>
            Save cart as template
          </Button>
        )}
      </div>

      {showSaveForm && (
        <div className="mt-3 flex gap-2">
          <Input placeholder="e.g. Office Setup Package" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button size="sm" onClick={saveTemplate} loading={saving} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {templates.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-caption">{t.items.length} product{t.items.length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" loading={applyingId === t.id} onClick={() => applyTemplate(t)}>
                  Order again
                </Button>
                <button type="button" aria-label={`Remove ${t.name}`} onClick={() => removeTemplate(t.id)} className="text-text-tertiary hover:text-danger">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
