'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Copy, MoreHorizontal, Package, ShoppingCart, Truck, Users2 } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { ActivityDetailsDialog } from '@/features/admin/ActivityDetailsDialog';
import { useAuth } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { companyService, type PlatformOrgMember } from '@/services/company.service';
import { purchaseOrderService } from '@/services/purchase-order.service';
import { auditLogService } from '@/services/audit-log.service';
import { describeActivity } from '@/lib/activityFeed';
import { Permission } from '@/config/rbac';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { Dialog } from '@/components/ui/Dialog';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatDateTime } from '@/utils/format';
import type { Company } from '@/types/company';
import type { PurchaseOrder } from '@/types/procurement';
import type { AuditEntry } from '@/types/common';

const COUNTRY_OPTIONS = ['GH', 'NG', 'KE', 'ZA', 'CI'];
const CURRENCY_OPTIONS = ['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD'];

/**
 * The platform admin's view of a single company (Phase 28, section 15; suspend/activate follow-
 * up). Every tab is backed by a real, separately-permission-gated route:
 *  - Overview: GET /api/companies/[companyId] (tenant bypass) for the profile card, plus the
 *    company's own real purchase order history (GET /api/companies/[companyId]/purchase-orders,
 *    also reachable cross-tenant via the same platform-admin ownsRecord bypass) to derive
 *    "Purchase orders", "Suppliers" (distinct supplierId across those orders), and "Products"
 *    (distinct productId across their line items) - real counts from this company's own
 *    transaction history, never invented fields with no backing data.
 *  - Members: GET /api/admin/companies/[companyId]/members (PLATFORM_MEMBERS_VIEW).
 *  - Activity: GET /api/audit-log?companyId=... (PLATFORM_AUDIT_VIEW), filtered server-side to
 *    this one company.
 *  - Settings: the same profile fields as Overview's Company Information card, plus the Edit
 *    entry point - kept as its own tab per the approved design direction, not a second source of
 *    truth.
 * Suspend/Activate call POST /api/admin/companies/[companyId]/suspend|activate
 * (PLATFORM_COMPANIES_SUSPEND/ACTIVATE) - see server/auth/context.ts's resolveTenant for where a
 * suspended company's own users actually lose transactional access; this page only shows and
 * triggers the transition.
 */
export default function CompanyDetailPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  return (
    <AdminGuard>
      <CompanyDetail companyId={companyId} />
    </AdminGuard>
  );
}

function CompanyDetail({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const { data: profile, loading, error, reload } = useAsyncData<Company>(companyId, () => companyService.getCompanyProfile(companyId));
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [confirmingSuspend, setConfirmingSuspend] = useState(false);
  const [confirmingActivate, setConfirmingActivate] = useState(false);

  if (error) return <ErrorState title="Couldn't load this company" description={error} secondaryAction={{ label: 'Back to companies', onClick: () => router.push('/admin/companies') }} />;
  if (loading || !profile) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const suspended = profile.status === 'SUSPENDED';
  const canSuspend = can(Permission.PLATFORM_COMPANIES_SUSPEND);
  const canActivate = can(Permission.PLATFORM_COMPANIES_ACTIVATE);
  const canEdit = can(Permission.PLATFORM_COMPANIES_UPDATE);

  async function handleSuspend() {
    const result = await companyService.suspendCompany(companyId);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    setConfirmingSuspend(false);
    toast.show(`${profile!.name} has been suspended.`, 'success');
    reload();
  }

  async function handleActivate() {
    const result = await companyService.activateCompany(companyId);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    setConfirmingActivate(false);
    toast.show(`${profile!.name} has been reactivated.`, 'success');
    reload();
  }

  function copyId() {
    navigator.clipboard.writeText(companyId);
    toast.show('Company ID copied.', 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Breadcrumb items={[{ label: 'Companies', href: '/admin/companies' }, { label: profile.name }]} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-bg text-text-secondary">
              <Building2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-h1">{profile.name}</h1>
                <StatusBadge domain="company" status={profile.status} />
              </div>
              <p className="text-body text-text-secondary">
                {profile.country} · {profile.currency} · joined {formatDate(profile.createdAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {suspended
              ? canActivate && (
                  <Button size="sm" onClick={() => setConfirmingActivate(true)}>
                    Activate
                  </Button>
                )
              : canSuspend && (
                  <Button variant="danger" size="sm" onClick={() => setConfirmingSuspend(true)}>
                    Suspend
                  </Button>
                )}
            <Button variant="outline" size="sm" onClick={() => setTab('members')}>
              View members
            </Button>
            <DropdownMenu
              trigger={
                <Button variant="outline" size="sm" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              }
            >
              <DropdownMenuItem onClick={() => setTab('members')}>View members</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTab('activity')}>View activity</DropdownMenuItem>
              <DropdownMenuItem onClick={copyId}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy company ID
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'members', label: 'Members' },
          { value: 'activity', label: 'Activity' },
          { value: 'settings', label: 'Settings' },
        ]}
      >
        {(t) =>
          t === 'overview' ? (
            <OverviewTab companyId={companyId} profile={profile} onSuspend={() => setConfirmingSuspend(true)} onActivate={() => setConfirmingActivate(true)} canSuspend={canSuspend} canActivate={canActivate} />
          ) : t === 'members' ? (
            <MembersTab companyId={companyId} />
          ) : t === 'activity' ? (
            <ActivityTab companyId={companyId} />
          ) : (
            <SettingsTab profile={profile} canEdit={canEdit} onEdit={() => setEditing(true)} />
          )
        }
      </Tabs>

      <CompanyEditDialog open={editing} company={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />

      <ConfirmationDialog
        open={confirmingSuspend}
        onClose={() => setConfirmingSuspend(false)}
        onConfirm={handleSuspend}
        title="Suspend organization?"
        description={`Members of ${profile.name} will be able to sign in, but will lose access to purchase requests, orders, RFQs, payments, and every other transactional feature until this organization is reactivated.`}
        confirmLabel="Suspend organization"
        destructive
      />
      <ConfirmationDialog
        open={confirmingActivate}
        onClose={() => setConfirmingActivate(false)}
        onConfirm={handleActivate}
        title="Activate organization?"
        description={`This restores full platform access for every member of ${profile.name}, including purchase requests, orders, RFQs, and payments.`}
        confirmLabel="Activate organization"
      />
    </div>
  );
}

function OverviewTab({
  companyId,
  profile,
  onSuspend,
  onActivate,
  canSuspend,
  canActivate,
}: {
  companyId: string;
  profile: Company;
  onSuspend: () => void;
  onActivate: () => void;
  canSuspend: boolean;
  canActivate: boolean;
}) {
  const { can } = useAuth();
  const hasMembersAccess = can(Permission.PLATFORM_MEMBERS_VIEW);
  const { data: members } = useAsyncData<PlatformOrgMember[]>(
    hasMembersAccess ? `overview-members-${companyId}` : null,
    () => companyService.listCompanyMembersAsPlatformAdmin(companyId),
  );
  const { data: purchaseOrders } = useAsyncData<PurchaseOrder[]>(`overview-pos-${companyId}`, () => purchaseOrderService.listPurchaseOrders(companyId));

  const supplierCount = useMemo(() => new Set((purchaseOrders ?? []).map((po) => po.supplierId)).size, [purchaseOrders]);
  const productCount = useMemo(
    () => new Set((purchaseOrders ?? []).flatMap((po) => po.items.map((i) => i.productId))).size,
    [purchaseOrders],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Members" value={members ? String(members.length) : '—'} icon={Users2} />
        <StatCard label="Suppliers" value={purchaseOrders ? String(supplierCount) : '—'} icon={Truck} />
        <StatCard label="Purchase orders" value={purchaseOrders ? String(purchaseOrders.length) : '—'} icon={ShoppingCart} />
        <StatCard label="Products" value={purchaseOrders ? String(productCount) : '—'} icon={Package} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Legal name" value={profile.legalName} />
              <Field label="Registration number" value={profile.registrationNumber} />
              <Field label="Tax ID" value={profile.taxId} />
              <Field label="Industry" value={profile.industry} />
              <Field label="Payment terms" value={profile.creditTerms.replace('_', ' ')} />
              <Field label="Website" value={profile.website} />
              <Field label="Contact email" value={profile.email} />
              <Field label="Phone" value={profile.phone} />
            </dl>
          </CardContent>
        </Card>

        <OrganizationStatusCard profile={profile} onSuspend={onSuspend} onActivate={onActivate} canSuspend={canSuspend} canActivate={canActivate} />
      </div>
    </div>
  );
}

function OrganizationStatusCard({
  profile,
  onSuspend,
  onActivate,
  canSuspend,
  canActivate,
}: {
  profile: Company;
  onSuspend: () => void;
  onActivate: () => void;
  canSuspend: boolean;
  canActivate: boolean;
}) {
  const suspended = profile.status === 'SUSPENDED';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization status</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {suspended ? (
          <div className="rounded-md border border-danger-border bg-danger-bg px-4 py-3">
            <p className="text-sm font-semibold text-danger">Organization suspended</p>
            <p className="mt-1 text-sm text-danger">
              Members of {profile.name} can still sign in, but every transactional feature - purchase requests,
              orders, RFQs, payments, invoices, and more - is blocked until this organization is reactivated.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-success-border bg-success-bg px-4 py-3">
            <p className="text-sm font-semibold text-success">Active</p>
            <p className="mt-1 text-sm text-success">This organization has full access to the platform.</p>
          </div>
        )}
        {suspended
          ? canActivate && (
              <Button size="sm" className="self-start" onClick={onActivate}>
                Activate organization
              </Button>
            )
          : canSuspend && (
              <Button variant="danger" size="sm" className="self-start" onClick={onSuspend}>
                Suspend organization
              </Button>
            )}
      </CardContent>
    </Card>
  );
}

function SettingsTab({ profile, canEdit, onEdit }: { profile: Company; canEdit: boolean; onEdit: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization settings</CardTitle>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Name" value={profile.name} />
          <Field label="Country" value={profile.country} />
          <Field label="Currency" value={profile.currency} />
          <Field label="Payment terms" value={profile.creditTerms.replace('_', ' ')} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-metadata">{label}</dt>
      <dd className="text-sm font-medium">{value || '—'}</dd>
    </div>
  );
}

function CompanyEditDialog({
  open,
  company,
  onClose,
  onSaved,
}: {
  open: boolean;
  company: Company;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(company.name);
  const [country, setCountry] = useState<string>(company.country);
  const [currency, setCurrency] = useState<string>(company.currency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError('Give the company a name.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await companyService.updateCompanyAsPlatformAdmin(company.id, { name: name.trim(), country, currency });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    toast.show(`${name} updated.`, 'success');
    onSaved();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit company"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        <Input label="Company name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
    </Dialog>
  );
}

function MembersTab({ companyId }: { companyId: string }) {
  const { can } = useAuth();
  const hasAccess = can(Permission.PLATFORM_MEMBERS_VIEW);
  const { data: members, loading, error } = useAsyncData<PlatformOrgMember[]>(
    hasAccess ? companyId : null,
    () => companyService.listCompanyMembersAsPlatformAdmin(companyId),
  );

  if (!hasAccess) {
    return <ErrorState title="You don't have access to this" description="Viewing organization members requires the platform members permission." />;
  }
  if (error) return <ErrorState title="Couldn't load members" description={error} />;
  if (loading) return <SkeletonTable rows={4} columns={5} />;
  if (!members || members.length === 0) {
    return <EmptyState icon={Users2} title="No members yet" description="This company has no team members yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-table">
        <thead>
          <tr className="text-metadata">
            <th className="p-4 text-left">Name</th>
            <th className="p-4 text-left">Email</th>
            <th className="p-4 text-left">Role</th>
            <th className="p-4 text-left">Status</th>
            <th className="p-4 text-left">Joined</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId} className="border-t border-border">
              <td className="p-4 font-medium">{m.name}</td>
              <td className="p-4 text-text-secondary">{m.email}</td>
              <td className="p-4">{m.role}</td>
              <td className="p-4">{m.status}</td>
              <td className="p-4 text-text-secondary">{m.joinedAt ? formatDate(m.joinedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTab({ companyId }: { companyId: string }) {
  const { data, loading, error } = useAsyncData(companyId, () => auditLogService.listEntries(null, 25, companyId));
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const entries = data?.items ?? [];

  if (error) return <ErrorState title="Couldn't load activity" description={error} />;
  if (loading) return <SkeletonTable rows={4} columns={3} />;
  if (entries.length === 0) {
    return <EmptyState icon={Users2} title="No activity yet" description="Sensitive administrative actions involving this company will appear here." />;
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => {
          const { label, icon: Icon } = describeActivity(e);
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSelected(e)}
                className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left text-sm hover:bg-neutral-bg"
              >
                <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span className="flex-1">
                  <span className="font-medium">{e.actorName}</span> {label}
                </span>
                <span className="text-caption shrink-0">{formatDateTime(e.timestamp)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <ActivityDetailsDialog entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}
