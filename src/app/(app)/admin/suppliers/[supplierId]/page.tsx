'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Copy, MoreHorizontal, Package, Star, Users2 } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { ActivityDetailsDialog } from '@/features/admin/ActivityDetailsDialog';
import { useAuth, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { catalogService, type PlatformSupplierRow } from '@/services/catalog.service';
import type { PlatformOrgMember } from '@/services/company.service';
import { auditLogService } from '@/services/audit-log.service';
import { describeActivity } from '@/lib/activityFeed';
import { Permission } from '@/config/rbac';
import { Badge } from '@/components/ui/Badge';
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
import type { Product } from '@/types/catalog';
import type { AuditEntry } from '@/types/common';

const COUNTRY_OPTIONS = ['GH', 'NG', 'KE', 'ZA', 'CI'];

/**
 * The platform admin's view of a single supplier (Phase 28, section 16; aligned to the same
 * header/action/tab/card design direction as the Company Detail page - suspend/activate
 * follow-up, section 10). Reuses existing, already-permission-gated endpoints:
 *  - Overview/header: GET /api/admin/suppliers (PLATFORM_CATALOG_MODERATE), matched by id.
 *  - Members: GET /api/admin/suppliers/[supplierId]/members (PLATFORM_MEMBERS_VIEW).
 *  - Products: GET /api/products/moderation (PLATFORM_CATALOG_MODERATE), filtered client-side.
 *  - Activity: GET /api/audit-log (PLATFORM_AUDIT_VIEW), filtered client-side to this supplier.
 * Verify/Suspend/Reject move here from the list-only action row (same PATCH
 * /api/suppliers/[supplierId]/verification, PLATFORM_CATALOG_MODERATE) behind the same
 * confirmation-dialog pattern the Company page uses for Suspend/Activate - a supplier's own
 * lifecycle stays exactly SupplierProfile.verification (never Company.status - suppliers are
 * deliberately outside the buyer-company suspension mechanism, see server/auth/context.ts). No
 * supplier deletion, here or anywhere.
 */
export default function SupplierDetailPage({ params }: { params: Promise<{ supplierId: string }> }) {
  const { supplierId } = use(params);
  return (
    <AdminGuard>
      <SupplierDetail supplierId={supplierId} />
    </AdminGuard>
  );
}

function SupplierDetail({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const { can } = useAuth();
  const membership = useActiveMembership();
  const { session } = useAuth();
  const toast = useToast();
  const { data: suppliers, loading, error, reload } = useAsyncData<PlatformSupplierRow[]>('admin-suppliers-detail', () => catalogService.listAllSuppliersForAdmin());
  const supplier = suppliers?.find((s) => s.id === supplierId);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<'VERIFIED' | 'SUSPENDED' | 'REJECTED' | null>(null);

  if (error) return <ErrorState title="Couldn't load this supplier" description={error} secondaryAction={{ label: 'Back to suppliers', onClick: () => router.push('/admin/suppliers') }} />;
  if (loading || !suppliers) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (!supplier) {
    return <EmptyState icon={Building2} title="Supplier not found" description="This supplier may have been removed." />;
  }

  const canModerate = can(Permission.PLATFORM_CATALOG_MODERATE);
  const canEdit = can(Permission.PLATFORM_SUPPLIERS_UPDATE);

  const CONFIRM_COPY: Record<'VERIFIED' | 'SUSPENDED' | 'REJECTED', { title: string; description: string; confirmLabel: string; destructive?: boolean }> = {
    VERIFIED: {
      title: supplier.verification === 'SUSPENDED' ? 'Reinstate supplier?' : 'Verify supplier?',
      description: `${supplier.name} will appear in the buyer-facing directory and can receive RFQ invitations.`,
      confirmLabel: supplier.verification === 'SUSPENDED' ? 'Reinstate supplier' : 'Verify supplier',
    },
    SUSPENDED: {
      title: 'Suspend supplier?',
      description: `${supplier.name} will be removed from the buyer-facing directory and can no longer receive RFQ invitations, until reinstated.`,
      confirmLabel: 'Suspend supplier',
      destructive: true,
    },
    REJECTED: {
      title: 'Reject supplier?',
      description: `${supplier.name} will not appear in the buyer-facing directory. This can be reversed later by verifying them.`,
      confirmLabel: 'Reject supplier',
      destructive: true,
    },
  };

  async function decide(decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED') {
    if (!session || !membership) return;
    const result = await catalogService.verifySupplier(supplierId, decision, membership.role, { id: session.user.id, name: session.user.name });
    setConfirming(null);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(`${supplier!.name} ${decision === 'VERIFIED' ? 'verified' : decision === 'SUSPENDED' ? 'suspended' : 'rejected'}.`, 'success');
    reload();
  }

  function copyId() {
    navigator.clipboard.writeText(supplierId);
    toast.show('Supplier ID copied.', 'success');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Breadcrumb items={[{ label: 'Suppliers', href: '/admin/suppliers' }, { label: supplier.name }]} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-bg text-text-secondary">
              <Building2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-h1">{supplier.name}</h1>
                <StatusBadge domain="supplierVerification" status={supplier.verification} />
              </div>
              <p className="text-body text-text-secondary">
                {supplier.city}, {supplier.country} · joined {formatDate(supplier.joinedAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {canModerate && supplier.verification === 'PENDING_VERIFICATION' && (
              <>
                <Button variant="outline" size="sm" onClick={() => setConfirming('REJECTED')}>
                  Reject
                </Button>
                <Button size="sm" onClick={() => setConfirming('VERIFIED')}>
                  Verify
                </Button>
              </>
            )}
            {canModerate && (supplier.verification === 'VERIFIED' || supplier.verification === 'PREMIUM_VERIFIED') && (
              <Button variant="danger" size="sm" onClick={() => setConfirming('SUSPENDED')}>
                Suspend
              </Button>
            )}
            {canModerate && supplier.verification === 'SUSPENDED' && (
              <Button size="sm" onClick={() => setConfirming('VERIFIED')}>
                Reinstate
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
              <DropdownMenuItem onClick={() => setTab('products')}>View products</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTab('activity')}>View activity</DropdownMenuItem>
              <DropdownMenuItem onClick={copyId}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy supplier ID
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
          { value: 'products', label: 'Products', count: supplier.productCount },
          { value: 'activity', label: 'Activity' },
          { value: 'settings', label: 'Settings' },
        ]}
      >
        {(t) =>
          t === 'overview' ? (
            <OverviewTab supplier={supplier} />
          ) : t === 'members' ? (
            <MembersTab supplierId={supplierId} />
          ) : t === 'products' ? (
            <ProductsTab supplierId={supplierId} />
          ) : t === 'activity' ? (
            <ActivityTab supplierId={supplierId} />
          ) : (
            <SettingsTab supplier={supplier} canEdit={canEdit} onEdit={() => setEditing(true)} />
          )
        }
      </Tabs>

      <SupplierEditDialog open={editing} supplier={supplier} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />

      <ConfirmationDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={async () => { if (confirming) await decide(confirming); }}
        title={confirming ? CONFIRM_COPY[confirming].title : ''}
        description={confirming ? CONFIRM_COPY[confirming].description : undefined}
        confirmLabel={confirming ? CONFIRM_COPY[confirming].confirmLabel : undefined}
        destructive={confirming ? CONFIRM_COPY[confirming].destructive : undefined}
      />
    </div>
  );
}

function OverviewTab({ supplier }: { supplier: PlatformSupplierRow }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Members" value={String(supplier.memberCount)} icon={Users2} />
        <StatCard label="Products" value={String(supplier.productCount)} icon={Package} />
        <StatCard label="Rating" value={`${supplier.rating.toFixed(1)}`} icon={Star} />
        <StatCard label="Completed orders" value={String(supplier.completedOrders)} icon={Building2} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Supplier information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="City" value={supplier.city} />
            <Field label="Country" value={supplier.country} />
            <Field label="Categories" value={supplier.categories.join(', ') || undefined} />
            <Field label="Certifications" value={supplier.certifications.join(', ') || undefined} />
            <Field label="Reviews" value={String(supplier.reviewCount)} />
          </dl>
          {supplier.description && <p className="mt-4 text-sm text-text-secondary">{supplier.description}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsTab({ supplier, canEdit, onEdit }: { supplier: PlatformSupplierRow; canEdit: boolean; onEdit: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Supplier settings</CardTitle>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Name" value={supplier.name} />
          <Field label="City" value={supplier.city} />
          <Field label="Country" value={supplier.country} />
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

function SupplierEditDialog({
  open,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean;
  supplier: PlatformSupplierRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(supplier.name);
  const [city, setCity] = useState(supplier.city);
  const [country, setCountry] = useState<string>(supplier.country);
  const [description, setDescription] = useState(supplier.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim() || !city.trim()) {
      setError('Give the supplier a name and city.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await catalogService.updateSupplierAsPlatformAdmin(supplier.id, { name: name.trim(), city: city.trim(), country, description });
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
      title="Edit supplier"
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
        <Input label="Supplier name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="City" required value={city} onChange={(e) => setCity(e.target.value)} />
        <Select label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Dialog>
  );
}

function MembersTab({ supplierId }: { supplierId: string }) {
  const { can } = useAuth();
  const hasAccess = can(Permission.PLATFORM_MEMBERS_VIEW);
  const { data: members, loading, error } = useAsyncData<PlatformOrgMember[]>(
    hasAccess ? supplierId : null,
    () => catalogService.listSupplierMembersAsPlatformAdmin(supplierId),
  );

  if (!hasAccess) {
    return <ErrorState title="You don't have access to this" description="Viewing organization members requires the platform members permission." />;
  }
  if (error) return <ErrorState title="Couldn't load members" description={error} />;
  if (loading) return <SkeletonTable rows={4} columns={5} />;
  if (!members || members.length === 0) {
    return <EmptyState icon={Users2} title="No members yet" description="This supplier has no team members yet." />;
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

function ProductsTab({ supplierId }: { supplierId: string }) {
  const { data: allProducts, loading, error } = useAsyncData<Product[]>('admin-products-for-supplier', () => catalogService.listAllProductsForModeration());
  const products = useMemo(() => allProducts?.filter((p) => p.supplierId === supplierId) ?? [], [allProducts, supplierId]);

  if (error) return <ErrorState title="Couldn't load products" description={error} />;
  if (loading) return <SkeletonTable rows={4} columns={3} />;
  if (products.length === 0) {
    return <EmptyState icon={Package} title="No products yet" description="This supplier has no product listings yet." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-table">
        <thead>
          <tr className="text-metadata">
            <th className="p-4 text-left">Product</th>
            <th className="p-4 text-left">SKU</th>
            <th className="p-4 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="p-4 font-medium">{p.name}</td>
              <td className="p-4 text-text-secondary">{p.sku}</td>
              <td className="p-4">
                <Badge tone={p.moderationStatus === 'PUBLISHED' ? 'success' : p.moderationStatus === 'REJECTED' ? 'danger' : 'warning'}>
                  {p.moderationStatus === 'PUBLISHED' ? 'Published' : p.moderationStatus === 'REJECTED' ? 'Rejected' : 'Pending review'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTab({ supplierId }: { supplierId: string }) {
  const { data, loading, error } = useAsyncData(supplierId, () => auditLogService.listEntries(null, 100));
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const entries = (data?.items ?? []).filter((e) => e.entityType === 'SupplierProfile' && e.entityId === supplierId);

  if (error) return <ErrorState title="Couldn't load activity" description={error} />;
  if (loading) return <SkeletonTable rows={4} columns={3} />;
  if (entries.length === 0) {
    return <EmptyState icon={Users2} title="No activity yet" description="Sensitive administrative actions involving this supplier will appear here." />;
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
