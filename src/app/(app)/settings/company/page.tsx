'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Plus, Trash2, Warehouse } from 'lucide-react';
import { useAuth, useActiveCompany, useActiveMembership, useTenantContext } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { companyService } from '@/services/company.service';
import { procurementService } from '@/services/procurement.service';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonText } from '@/components/ui/Skeleton';
import { BUYER_ROLES, hasPermission, Permission, RoleLabels, type Role } from '@/config/rbac';
import { formatMoney } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { CompanyProfilePatch } from '@/services/company.service';
import type { NewApprovalRuleInput } from '@/services/procurement.service';
import type { Branch, Company, CostCenter, Department } from '@/types/company';
import type { ApprovalRule } from '@/types/procurement';
import type { CurrencyCode, TenantContext } from '@/types/common';

export default function CompanySettingsPage() {
  const { can } = useAuth();
  const company = useActiveCompany();
  const membership = useActiveMembership();
  const tenant = useTenantContext();

  if (!can(Permission.SETTINGS_MANAGE)) {
    return (
      <ErrorState
        title="You don't have access to this page"
        description="Managing company settings requires the settings.manage permission - ask a company owner or administrator."
      />
    );
  }

  if (!company || !membership) return null;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/settings" className="flex w-fit items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to settings
      </Link>

      <div>
        <h1 className="text-h1">Company settings</h1>
        <p className="text-body text-text-secondary">Profile, branches, departments, and cost centers for {company.name}.</p>
      </div>

      <ProfileSection company={company} callerRole={membership.role} tenant={tenant} />
      <BranchesSection companyId={company.id} callerRole={membership.role} tenant={tenant} addresses={company.addresses} />
      <DepartmentsSection companyId={company.id} callerRole={membership.role} tenant={tenant} />
      <CostCentersSection companyId={company.id} callerRole={membership.role} tenant={tenant} />
      <SpendingLimitsSection companyId={company.id} callerRole={membership.role} tenant={tenant} />
      <ApprovalRulesSection companyId={company.id} currency={company.currency} callerRole={membership.role} tenant={tenant} />
    </div>
  );
}

function ProfileSection({ company, callerRole, tenant }: { company: Company; callerRole: Role; tenant: TenantContext }) {
  const [form, setForm] = useState<CompanyProfilePatch>({
    name: company.name,
    legalName: company.legalName ?? '',
    registrationNumber: company.registrationNumber ?? '',
    taxId: company.taxId ?? '',
    industry: company.industry ?? '',
    website: company.website ?? '',
    phone: company.phone ?? '',
    email: company.email ?? '',
    description: company.description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CompanyProfilePatch>(key: K, value: string) {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await companyService.updateCompanyProfile(company.id, form, callerRole, tenant);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company profile</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Company name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <Input label="Legal name" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
          <Input label="Registration number" value={form.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} />
          <Input label="Tax number" value={form.taxId} onChange={(e) => set('taxId', e.target.value)} />
          <Input label="Industry" value={form.industry} onChange={(e) => set('industry', e.target.value)} />
          <Input label="Website" value={form.website} onChange={(e) => set('website', e.target.value)} />
          <Input label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-sm font-medium">Description</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        {error && <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
      </CardContent>
      <CardFooter>
        {saved && <span className="text-sm text-success">Saved</span>}
        <Button onClick={save} loading={saving}>
          Save changes
        </Button>
      </CardFooter>
    </Card>
  );
}

function BranchesSection({
  companyId,
  callerRole,
  tenant,
  addresses,
}: {
  companyId: string;
  callerRole: Role;
  tenant: TenantContext;
  addresses: Company['addresses'];
}) {
  const { data: branches, reload } = useAsyncData<Branch[]>(companyId, () => companyService.listBranches(companyId));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? '');
  const [contactName, setContactName] = useState('');
  const [isWarehouse, setIsWarehouse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    const result = await companyService.createBranch(
      { companyId, name, addressId, contactName: contactName || undefined, isWarehouse },
      callerRole,
      tenant,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setAdding(false);
    setName('');
    setContactName('');
    setIsWarehouse(false);
    reload();
  }

  async function remove(branchId: string) {
    await companyService.removeBranch(branchId, callerRole, tenant);
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branches</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add branch
        </Button>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4 flex flex-col gap-3 rounded-md border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Branch name" value={name} onChange={(e) => setName(e.target.value)} required />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Address</label>
                <select
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                  className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {addresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} - {a.city}
                    </option>
                  ))}
                </select>
              </div>
              <Input label="Contact name (optional)" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <label className="mt-6 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isWarehouse} onChange={(e) => setIsWarehouse(e.target.checked)} className="h-4 w-4 rounded border-border accent-accent" />
                This branch is also a warehouse
              </label>
            </div>
            {error && <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdding(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={submit} loading={saving} disabled={!name.trim() || !addressId}>
                Add
              </Button>
            </div>
          </div>
        )}

        {branches === null ? (
          <SkeletonText lines={3} />
        ) : branches.length === 0 ? (
          <EmptyState icon={Building2} title="No branches yet" description="Add your company's locations here." className="border-0" />
        ) : (
          <ul className="flex flex-col gap-2">
            {branches.map((branch) => {
              const address = addresses.find((a) => a.id === branch.addressId);
              return (
                <li key={branch.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                  <div>
                    <p className="flex items-center gap-1.5 font-medium">
                      {branch.name}
                      {branch.isHeadOffice && <Badge tone="info">Head office</Badge>}
                      {branch.isWarehouse && (
                        <span className="flex items-center gap-1 text-caption">
                          <Warehouse className="h-3.5 w-3.5" aria-hidden="true" /> Warehouse
                        </span>
                      )}
                    </p>
                    <p className="text-caption">
                      {address ? `${address.line1}, ${address.city}` : 'No address on file'}
                      {branch.contactName && ` · ${branch.contactName}`}
                    </p>
                  </div>
                  {!branch.isHeadOffice && (
                    <Button variant="ghost" size="icon" onClick={() => remove(branch.id)} aria-label={`Remove ${branch.name}`}>
                      <Trash2 className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DepartmentsSection({ companyId, callerRole, tenant }: { companyId: string; callerRole: Role; tenant: TenantContext }) {
  const { data: departments, reload } = useAsyncData<Department[]>(companyId, () => companyService.listDepartments(companyId));
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const result = await companyService.createDepartment(companyId, name, callerRole, tenant);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setName('');
    reload();
  }

  async function remove(departmentId: string) {
    await companyService.removeDepartment(departmentId, callerRole, tenant);
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-2">
          <Input placeholder="e.g. Logistics" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <Button onClick={submit} loading={saving} disabled={!name.trim()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
        {error && <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

        {departments === null ? (
          <SkeletonText lines={3} />
        ) : departments.length === 0 ? (
          <p className="text-caption">No departments yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => (
              <span key={d.id} className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm">
                {d.name}
                <button type="button" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`} className="text-text-tertiary hover:text-danger">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CostCentersSection({ companyId, callerRole, tenant }: { companyId: string; callerRole: Role; tenant: TenantContext }) {
  const { data: costCenters, reload } = useAsyncData<CostCenter[]>(companyId, () => companyService.listCostCenters(companyId));
  const { data: departments } = useAsyncData<Department[]>(companyId, () => companyService.listDepartments(companyId));
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const result = await companyService.createCostCenter(companyId, code, name, departmentId || undefined, callerRole, tenant);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCode('');
    setName('');
    setDepartmentId('');
    reload();
  }

  async function remove(costCenterId: string) {
    await companyService.removeCostCenter(costCenterId, callerRole, tenant);
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost centers</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          <Input placeholder="Code, e.g. IT-002" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">No department</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button onClick={submit} loading={saving} disabled={!code.trim() || !name.trim()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
        {error && <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

        {costCenters === null ? (
          <SkeletonText lines={3} />
        ) : costCenters.length === 0 ? (
          <p className="text-caption">No cost centers yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {costCenters.map((cc) => (
              <li key={cc.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {cc.code} · {cc.name}
                  </p>
                  {cc.departmentId && (
                    <p className="text-caption">{(departments ?? []).find((d) => d.id === cc.departmentId)?.name}</p>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(cc.id)} aria-label={`Remove ${cc.code}`}>
                  <Trash2 className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SpendingLimitsSection({ companyId, callerRole, tenant }: { companyId: string; callerRole: Role; tenant: TenantContext }) {
  const { data: limits, reload } = useAsyncData<{ role: Role; amount: number | undefined }[]>(companyId, () =>
    companyService.listSpendingLimits(companyId),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(role: Role) {
    const raw = drafts[role];
    const amount = Number(raw);
    if (raw === undefined || Number.isNaN(amount)) return;
    setSavingRole(role);
    setError(null);
    const result = await companyService.setSpendingLimit(companyId, role, amount, callerRole, tenant);
    setSavingRole(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending limits</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-caption">
          The maximum a single purchase request may total, per role - not a replacement for approval policies, an
          additional cap on how large one request from that role can be before someone with a higher limit needs to
          submit it instead.
        </p>
        {error && <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
        {limits === null ? (
          <SkeletonText lines={3} />
        ) : (
          <ul className="flex flex-col gap-2">
            {limits.map(({ role, amount }) => (
              <li key={role} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <span className="font-medium">{RoleLabels[role]}</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={drafts[role] ?? (amount !== undefined ? String(amount) : '')}
                    onChange={(e) => setDrafts({ ...drafts, [role]: e.target.value })}
                    placeholder="No limit"
                    className="w-32"
                  />
                  <Button size="sm" variant="outline" loading={savingRole === role} onClick={() => save(role)}>
                    Save
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Approvable roles for a rule's required-approver picker (section 12) - only roles that
 *  actually hold PURCHASE_REQUEST_APPROVE, so an admin can't configure a band that could never
 *  be acted on and would permanently strand any request that lands in it. */
const APPROVER_ROLE_OPTIONS = BUYER_ROLES.filter((role) => hasPermission(role, Permission.PURCHASE_REQUEST_APPROVE));

function ApprovalRulesSection({
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
  const { data: rules, reload } = useAsyncData<ApprovalRule[]>(companyId, () => procurementService.listApprovalRules(companyId));
  const [adding, setAdding] = useState(false);
  const [minAmount, setMinAmount] = useState('0');
  const [maxAmount, setMaxAmount] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<Role[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(role: Role) {
    setSelectedRoles((roles) => (roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const input: NewApprovalRuleInput = {
      companyId,
      minAmount: Number(minAmount) || 0,
      maxAmount: maxAmount.trim() ? Number(maxAmount) : undefined,
      requiredApproverRoles: selectedRoles,
    };
    const result = await procurementService.createApprovalRule(input, callerRole, tenant);
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setMinAmount('0');
    setMaxAmount('');
    setSelectedRoles([]);
    setAdding(false);
    reload();
  }

  async function remove(ruleId: string) {
    setError(null);
    await procurementService.removeApprovalRule(ruleId, callerRole, tenant);
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval rules</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-caption">
          Which roles must approve a purchase request, based on its total amount. A request whose amount doesn&rsquo;t
          match any rule falls back to a single company-owner approval, so it&rsquo;s never left ungated.
        </p>
        {error && <p className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

        {rules === null ? (
          <SkeletonText lines={3} />
        ) : rules.length === 0 && !adding ? (
          <p className="text-caption">No approval rules yet - every request falls back to a single owner approval.</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {formatMoney(rule.minAmount, currency)} – {rule.maxAmount !== undefined ? formatMoney(rule.maxAmount, currency) : 'no limit'}
                  </p>
                  <p className="text-caption">
                    Requires: {rule.requiredApproverRoles.map((r) => RoleLabels[r as Role] ?? r).join(' → ')}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(rule.id)} aria-label="Remove rule">
                  <Trash2 className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="flex flex-col gap-3 rounded-md border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Minimum amount" type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
              <Input
                label="Maximum amount"
                type="number"
                placeholder="No limit"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
              />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">Required approvers, in order</p>
              <div className="flex flex-wrap gap-2">
                {APPROVER_ROLE_OPTIONS.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      selectedRoles.includes(role)
                        ? 'border-accent bg-accent text-accent-foreground'
                        : 'border-border text-text-secondary hover:bg-neutral-bg',
                    )}
                  >
                    {selectedRoles.includes(role) ? `${selectedRoles.indexOf(role) + 1}. ` : ''}
                    {RoleLabels[role]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={submit} loading={saving} disabled={selectedRoles.length === 0}>
                Create rule
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add rule
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
