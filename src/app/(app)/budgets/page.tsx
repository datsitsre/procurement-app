'use client';

import { useState } from 'react';
import { PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership, useTenantContext, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { budgetsService, DEFAULT_ALERT_THRESHOLDS } from '@/services/budgets.service';
import { companyService } from '@/services/company.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { Permission, type Role } from '@/config/rbac';
import { formatMoney } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { BudgetUtilization, NewBudgetInput } from '@/services/budgets.service';
import type { Department, CostCenter } from '@/types/company';
import type { CurrencyCode, TenantContext } from '@/types/common';

export default function BudgetsPage() {
  const workspace = useWorkspace();
  const { can } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const tenant = useTenantContext();

  if (workspace !== 'buyer') {
    return <ErrorState title="Not available" description="Procurement budgets are part of the buyer workspace." />;
  }
  if (!can(Permission.ANALYTICS_READ)) {
    return (
      <ErrorState
        title="You don't have access to this page"
        description="Viewing procurement budgets requires the analytics.read permission."
      />
    );
  }
  if (!company || !membership) return null;

  return <BudgetsView companyId={company.id} currency={company.currency} callerRole={membership.role} tenant={tenant} />;
}

function toneForAlert(alertLevel: number | null): 'success' | 'warning' | 'danger' {
  if (alertLevel === null) return 'success';
  if (alertLevel >= 100) return 'danger';
  return 'warning';
}

const toneBar: Record<'success' | 'warning' | 'danger', string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

function BudgetsView({
  companyId,
  currency,
  callerRole,
  tenant,
}: {
  companyId: string;
  currency: CurrencyCode;
  callerRole: Role;
  tenant: TenantContext;
}) {
  const { can } = useAuth();
  const canManage = can(Permission.SETTINGS_MANAGE);
  const { data: utilization, reload } = useAsyncData<BudgetUtilization[]>(companyId, () => budgetsService.listUtilization(companyId));
  const { data: departments } = useAsyncData<Department[]>(companyId, () => companyService.listDepartments(companyId));
  const { data: costCenters } = useAsyncData<CostCenter[]>(companyId, () => companyService.listCostCenters(companyId));
  const [adding, setAdding] = useState(false);

  async function removeBudget(budgetId: string) {
    await budgetsService.removeBudget(budgetId, callerRole, tenant);
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1">Procurement budgets</h1>
          <p className="text-body text-text-secondary">Spend against each budget, computed live from paid orders.</p>
        </div>
        {canManage && (
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add budget
          </Button>
        )}
      </div>

      {canManage && <AlertThresholdsSection companyId={companyId} callerRole={callerRole} tenant={tenant} />}

      {adding && (
        <NewBudgetForm
          companyId={companyId}
          callerRole={callerRole}
          departments={departments ?? []}
          costCenters={costCenters ?? []}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {utilization === null ? (
        <SkeletonText lines={4} />
      ) : utilization.length === 0 ? (
        <EmptyState icon={PiggyBank} title="No budgets yet" description="Set up a budget to track spend by department or cost center." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {utilization.map((u) => {
            const tone = toneForAlert(u.alertLevel);
            return (
              <div key={u.budget.id} className="rounded-lg border border-border bg-surface p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-h3">{u.label}</p>
                    <p className="text-caption">
                      {u.budget.period === 'ANNUAL' ? `${u.budget.year} · Annual` : `${u.budget.year}-${String(u.budget.month).padStart(2, '0')} · Monthly`}
                    </p>
                  </div>
                  {canManage && (
                    <button type="button" aria-label={`Remove ${u.label} budget`} onClick={() => removeBudget(u.budget.id)} className="text-text-tertiary hover:text-danger">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-neutral-bg">
                  <div className={cn('h-full rounded-full', toneBar[tone])} style={{ width: `${Math.min(100, u.percentUsed)}%` }} />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    {formatMoney(u.spent, currency)} of {formatMoney(u.budget.amount, currency)}
                  </span>
                  <span className={cn('font-semibold', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-success')}>
                    {u.percentUsed}%
                  </span>
                </div>
                <p className="mt-1 text-caption">
                  {u.remaining >= 0 ? `${formatMoney(u.remaining, currency)} remaining` : `${formatMoney(-u.remaining, currency)} over budget`}
                </p>
                {u.alertLevel !== null && (
                  <p className={cn('mt-2 text-xs font-medium', tone === 'danger' ? 'text-danger' : 'text-warning')}>
                    {u.alertLevel >= 100 ? 'Budget exceeded' : `Crossed the ${u.alertLevel}% alert threshold`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlertThresholdsSection({ companyId, callerRole, tenant }: { companyId: string; callerRole: Role; tenant: TenantContext }) {
  const { data: thresholds, reload } = useAsyncData<number[]>(companyId, () => budgetsService.getAlertThresholds(companyId));
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? (thresholds ?? DEFAULT_ALERT_THRESHOLDS).join(', ');

  async function save() {
    const parsed = value
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    if (parsed.length === 0) return;
    setSaving(true);
    setError(null);
    const result = await budgetsService.setAlertThresholds(companyId, parsed, callerRole, tenant);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDraft(null);
    reload();
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-2 text-sm font-semibold">Budget alert thresholds</p>
      <p className="mb-3 text-caption">Comma-separated percentages - a budget crossing any of these is flagged above.</p>
      <div className="flex items-center gap-2">
        <Input value={value} onChange={(e) => setDraft(e.target.value)} className="max-w-xs" />
        <Button size="sm" variant="outline" onClick={save} loading={saving}>
          Save
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

function NewBudgetForm({
  companyId,
  callerRole,
  departments,
  costCenters,
  onCreated,
  onCancel,
}: {
  companyId: string;
  callerRole: Role;
  departments: Department[];
  costCenters: CostCenter[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const tenant = useTenantContext();
  const [scope, setScope] = useState<NewBudgetInput['scope']>('COMPANY');
  const [department, setDepartment] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [period, setPeriod] = useState<NewBudgetInput['period']>('ANNUAL');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState('1');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const result = await budgetsService.createBudget(
      {
        companyId,
        scope,
        department: scope === 'DEPARTMENT' ? department : undefined,
        costCenterId: scope === 'COST_CENTER' ? costCenterId : undefined,
        period,
        year: Number(year),
        month: period === 'MONTHLY' ? Number(month) : undefined,
        amount: Number(amount),
      },
      callerRole,
      tenant,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onCreated();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-h3">New budget</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Scope</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as NewBudgetInput['scope'])} className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
            <option value="COMPANY">Company-wide</option>
            <option value="DEPARTMENT">Department</option>
            <option value="COST_CENTER">Cost center</option>
          </select>
        </div>
        {scope === 'DEPARTMENT' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
              <option value="">Select a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {scope === 'COST_CENTER' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Cost center</label>
            <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
              <option value="">Select a cost center</option>
              {costCenters.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} · {cc.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Period</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value as NewBudgetInput['period'])} className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
            <option value="ANNUAL">Annual</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </div>
        <Input label="Year" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        {period === 'MONTHLY' && <Input label="Month (1-12)" type="number" value={month} onChange={(e) => setMonth(e.target.value)} />}
        <Input label="Budget amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          loading={saving}
          disabled={!amount || (scope === 'DEPARTMENT' && !department) || (scope === 'COST_CENTER' && !costCenterId)}
        >
          Create budget
        </Button>
      </div>
    </div>
  );
}
