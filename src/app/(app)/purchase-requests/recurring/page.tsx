'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, PauseCircle, PlayCircle, Repeat, Trash2 } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership, useTenantContext, useWorkspace } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useCart } from '@/hooks/useCart';
import { recurringService } from '@/services/recurring.service';
import { companyService } from '@/services/company.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { Permission } from '@/config/rbac';
import { formatDate } from '@/utils/format';
import type { CartLine } from '@/hooks/useCart';
import type { NewRecurringPurchaseInput } from '@/services/recurring.service';
import type { Department, CostCenter } from '@/types/company';
import type { RecurringFrequency, RecurringPurchase } from '@/types/procurement';
import type { Role } from '@/config/rbac';
import type { TenantContext } from '@/types/common';

const FrequencyLabels: Record<RecurringFrequency, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  CUSTOM: 'Custom interval',
};

export default function RecurringPurchasesPage() {
  const workspace = useWorkspace();
  const { can, session } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const tenant = useTenantContext();

  if (workspace !== 'buyer') {
    return <ErrorState title="Not available" description="Recurring purchases are part of the buyer workspace." />;
  }
  if (!can(Permission.PURCHASE_REQUEST_CREATE)) {
    return (
      <ErrorState
        title="You don't have access to this page"
        description="Setting up recurring purchases requires the purchase_request.create permission."
      />
    );
  }
  if (!company || !membership || !session) return null;

  return (
    <RecurringPurchasesView
      companyId={company.id}
      userId={session.user.id}
      userName={session.user.name}
      callerRole={membership.role}
      tenant={tenant}
    />
  );
}

function RecurringPurchasesView({
  companyId,
  userId,
  userName,
  callerRole,
  tenant,
}: {
  companyId: string;
  userId: string;
  userName: string;
  callerRole: Role;
  tenant: TenantContext;
}) {
  const { lines } = useCart();
  // No longer runs due schedules as a side effect of loading this page (Phase 15) - a real
  // backend cron (`/api/cron/recurring-purchase-sweep`) now does that on a schedule, whether or
  // not anyone ever opens this page. "Run due schedules now" below still exists as a manual,
  // authenticated trigger for the same server-side sweep, for whoever wants to see it happen
  // immediately rather than wait for the next scheduled run.
  const { data: schedules, reload } = useAsyncData<RecurringPurchase[]>(companyId, () => recurringService.listRecurringPurchases(companyId));
  const { data: departments } = useAsyncData<Department[]>(companyId, () => companyService.listDepartments(companyId));
  const { data: costCenters } = useAsyncData<CostCenter[]>(companyId, () => companyService.listCostCenters(companyId));
  const [creating, setCreating] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [runWarnings, setRunWarnings] = useState<string[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(schedule: RecurringPurchase) {
    setBusyId(schedule.id);
    await recurringService.setActive(schedule.id, !schedule.active, callerRole, tenant);
    setBusyId(null);
    reload();
  }

  async function remove(schedule: RecurringPurchase) {
    setBusyId(schedule.id);
    await recurringService.removeRecurringPurchase(schedule.id, callerRole, tenant);
    setBusyId(null);
    reload();
  }

  async function runNow() {
    setRunningNow(true);
    setRunWarnings(null);
    const result = await recurringService.runDue(companyId, callerRole, tenant);
    setRunningNow(false);
    if (result.ok) {
      setRunWarnings(result.data.warnings);
      reload();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/purchase-requests" className="mb-2 inline-flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Purchase requests
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-h1">Recurring purchases</h1>
            <p className="text-body text-text-secondary">
              Standing orders that submit a purchase request on a schedule - through the same approval rules and spending
              limits as a manual request.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={runNow} loading={runningNow}>
              <Repeat className="h-4 w-4" aria-hidden="true" />
              Run due schedules now
            </Button>
            <Button onClick={() => setCreating((v) => !v)}>New schedule</Button>
          </div>
        </div>
      </div>

      {runWarnings && runWarnings.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          <ul className="list-inside list-disc">
            {runWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {creating && (
        <NewScheduleForm
          companyId={companyId}
          userId={userId}
          userName={userName}
          callerRole={callerRole}
          currentLines={lines}
          departments={departments ?? []}
          costCenters={costCenters ?? []}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {schedules === null ? (
        <SkeletonText lines={4} />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No recurring purchases yet"
          description="Add items to your cart, then create a schedule to reorder them automatically."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {schedules.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{s.name}</p>
                  <p className="text-caption">
                    {FrequencyLabels[s.frequency]}
                    {s.frequency === 'CUSTOM' && s.customIntervalDays ? ` (every ${s.customIntervalDays} days)` : ''} ·{' '}
                    {s.items.length} product{s.items.length === 1 ? '' : 's'}
                    {s.department ? ` · ${s.department}` : ''}
                  </p>
                  <p className="text-caption">
                    Next run {formatDate(s.nextRunAt)}
                    {s.lastRunAt ? ` · last ran ${formatDate(s.lastRunAt)}` : ''}
                    {s.createdPurchaseRequestIds.length > 0 ? ` · ${s.createdPurchaseRequestIds.length} request(s) created` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      s.active ? 'rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success' : 'rounded-full bg-neutral-bg px-2 py-0.5 text-xs font-medium text-text-tertiary'
                    }
                  >
                    {s.active ? 'Active' : 'Paused'}
                  </span>
                  <Button size="sm" variant="outline" loading={busyId === s.id} onClick={() => toggleActive(s)}>
                    {s.active ? (
                      <>
                        <PauseCircle className="h-4 w-4" aria-hidden="true" />
                        Pause
                      </>
                    ) : (
                      <>
                        <PlayCircle className="h-4 w-4" aria-hidden="true" />
                        Resume
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => remove(s)}
                    className="text-text-tertiary hover:text-danger"
                    disabled={busyId === s.id}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewScheduleForm({
  companyId,
  userId,
  userName,
  callerRole,
  currentLines,
  departments,
  costCenters,
  onCreated,
  onCancel,
}: {
  companyId: string;
  userId: string;
  userName: string;
  callerRole: Role;
  currentLines: CartLine[];
  departments: Department[];
  costCenters: CostCenter[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('MONTHLY');
  const [customIntervalDays, setCustomIntervalDays] = useState('30');
  const [department, setDepartment] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCart = currentLines.length > 0;

  async function submit() {
    if (!hasCart) return;
    setSaving(true);
    setError(null);
    const input: NewRecurringPurchaseInput = {
      companyId,
      name,
      items: currentLines.map((l) => ({ productId: l.product.id, productName: l.product.name, quantity: l.item.quantity })),
      frequency,
      customIntervalDays: frequency === 'CUSTOM' ? Number(customIntervalDays) : undefined,
      requesterUserId: userId,
      requesterName: userName,
      department: department || undefined,
      costCenterId: costCenterId || undefined,
    };
    const result = await recurringService.createRecurringPurchase(input, callerRole);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onCreated();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <h2 className="text-h3">New recurring purchase</h2>
      {!hasCart ? (
        <p className="text-sm text-text-secondary">
          Your cart is empty. <Link href="/catalog" className="text-accent hover:underline">Add products</Link> to your cart
          first - a schedule is built from what&rsquo;s currently in it.
        </p>
      ) : (
        <p className="text-caption">
          This schedule will reorder the {currentLines.length} product{currentLines.length === 1 ? '' : 's'} currently in
          your cart.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Name" placeholder="e.g. Monthly office supplies" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Frequency</label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
          >
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="CUSTOM">Custom interval</option>
          </select>
        </div>
        {frequency === 'CUSTOM' && (
          <Input
            label="Interval (days)"
            type="number"
            value={customIntervalDays}
            onChange={(e) => setCustomIntervalDays(e.target.value)}
          />
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Department (optional)</label>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Cost center (optional)</label>
          <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm">
            <option value="">None</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.code} · {cc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!hasCart || !name.trim()}>
          Create schedule
        </Button>
      </div>
    </div>
  );
}
