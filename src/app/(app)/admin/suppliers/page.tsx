'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, Search } from 'lucide-react';
import { useAuth, useActiveMembership } from '@/hooks/useAuth';
import { useAsyncData } from '@/hooks/useAsyncData';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { catalogService, type NewPlatformSupplierInput, type PlatformSupplierRow } from '@/services/catalog.service';
import { Permission } from '@/config/rbac';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/utils/format';

const COUNTRY_OPTIONS = ['GH', 'NG', 'KE', 'ZA', 'CI'];
const CURRENCY_OPTIONS = ['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD'];

type SortKey = 'name' | 'country' | 'joined' | 'products';
type StatusFilter = 'all' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'PREMIUM_VERIFIED' | 'SUSPENDED' | 'REJECTED';

/**
 * The platform Suppliers management table (Phase 27 - Platform Command Center). Same real,
 * already-working actions the previous card-list layout had (PATCH
 * /api/suppliers/[supplierId]/verification, PLATFORM_CATALOG_MODERATE - available to
 * PLATFORM_MANAGER too, not just PLATFORM_SUPER_ADMIN), just presented as a searchable/sortable
 * table matching the Companies page. "View Users"/"View Products"/"View Activity"/"Delete" are
 * NOT implemented - no backend route exists a platform-tier role can call for any of them (see
 * this phase's final report).
 */
export default function AdminSuppliersPage() {
  return (
    <AdminGuard>
      <SuppliersDirectory />
    </AdminGuard>
  );
}

function SuppliersDirectory() {
  const { session, can } = useAuth();
  const membership = useActiveMembership();
  const { data: suppliers, error, reload } = useAsyncData<PlatformSupplierRow[]>('admin-suppliers-table', () => catalogService.listAllSuppliersForAdmin());
  const toast = useToast();
  const [actingId, setActingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('joined');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformSupplierRow | null>(null);

  const countries = useMemo(() => Array.from(new Set(suppliers?.map((s) => s.country) ?? [])).sort(), [suppliers]);

  const filtered = useMemo(() => {
    if (!suppliers) return [];
    const q = search.trim().toLowerCase();
    const list = suppliers.filter(
      (s) =>
        (country === 'all' || s.country === country) &&
        (status === 'all' || s.verification === status) &&
        (!q || s.name.toLowerCase().includes(q)),
    );
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'country') return a.country.localeCompare(b.country);
      if (sort === 'products') return b.productCount - a.productCount;
      return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
    });
  }, [suppliers, search, country, status, sort]);

  const DECISION_LABEL: Record<'VERIFIED' | 'SUSPENDED' | 'REJECTED', string> = {
    VERIFIED: 'verified',
    SUSPENDED: 'suspended',
    REJECTED: 'rejected',
  };

  async function decide(supplierId: string, supplierName: string, decision: 'VERIFIED' | 'SUSPENDED' | 'REJECTED') {
    if (!session || !membership) return;
    setActingId(supplierId);
    const result = await catalogService.verifySupplier(supplierId, decision, membership.role, {
      id: session.user.id,
      name: session.user.name,
    });
    setActingId(null);
    if (!result.ok) {
      toast.show(result.error.message, 'error');
      return;
    }
    toast.show(`${supplierName} ${DECISION_LABEL[decision]}.`, 'success');
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">Suppliers</h1>
          <p className="text-body text-text-secondary">Manage suppliers connected to the procurement platform.</p>
        </div>
        {can(Permission.PLATFORM_SUPPLIERS_CREATE) && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add supplier
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState title="Couldn't load suppliers" description={error} secondaryAction={{ label: 'Try again', onClick: reload }} />
      ) : suppliers === null ? (
        <SkeletonTable rows={6} columns={6} />
      ) : suppliers.length === 0 ? (
        <EmptyState icon={Building2} title="No suppliers yet" description="Suppliers who register will appear here for verification." />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 sm:max-w-xs">
              <Input
                placeholder="Search suppliers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leadingIcon={<Search className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
            <Select value={country} onChange={(e) => setCountry(e.target.value)} className="sm:w-36">
              <option value="all">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="sm:w-44">
              <option value="all">All statuses</option>
              <option value="PENDING_VERIFICATION">Pending verification</option>
              <option value="VERIFIED">Verified</option>
              <option value="PREMIUM_VERIFIED">Premium verified</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REJECTED">Rejected</option>
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sm:w-40">
              <option value="joined">Newest first</option>
              <option value="name">Name (A-Z)</option>
              <option value="country">Country</option>
              <option value="products">Most products</option>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Search} title="No suppliers match" description="Try a different search or filter." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-table">
                <thead>
                  <tr className="text-metadata">
                    <th className="p-4 text-left">Supplier</th>
                    <th className="p-4 text-left">Country</th>
                    <th className="p-4 text-right">Products</th>
                    <th className="p-4 text-right">Users</th>
                    <th className="p-4 text-left">Status</th>
                    <th className="p-4 text-left">Joined</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="p-4 font-medium">{s.name}</td>
                      <td className="p-4">
                        {s.city}, {s.country}
                      </td>
                      <td className="p-4 text-right">{s.productCount}</td>
                      <td className="p-4 text-right">{s.memberCount}</td>
                      <td className="p-4">
                        <StatusBadge domain="supplierVerification" status={s.verification} />
                      </td>
                      <td className="p-4 text-text-secondary">{formatDate(s.joinedAt)}</td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/suppliers/${s.id}`}>
                            <Button size="sm" variant="outline">
                              View
                            </Button>
                          </Link>
                          {can(Permission.PLATFORM_SUPPLIERS_UPDATE) && (
                            <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                              Edit
                            </Button>
                          )}
                          {s.verification === 'PENDING_VERIFICATION' && (
                            <>
                              <Button size="sm" variant="outline" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'REJECTED')}>
                                Reject
                              </Button>
                              <Button size="sm" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'VERIFIED')}>
                                Verify
                              </Button>
                            </>
                          )}
                          {(s.verification === 'VERIFIED' || s.verification === 'PREMIUM_VERIFIED') && (
                            <Button size="sm" variant="outline" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'SUSPENDED')}>
                              Suspend
                            </Button>
                          )}
                          {s.verification === 'SUSPENDED' && (
                            <Button size="sm" loading={actingId === s.id} onClick={() => decide(s.id, s.name, 'VERIFIED')}>
                              Reinstate
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <SupplierFormDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          reload();
        }}
      />
      <SupplierFormDialog
        key={editing?.id ?? 'no-edit'}
        open={!!editing}
        mode="edit"
        supplier={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    </div>
  );
}

function SupplierFormDialog({
  open,
  mode,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  supplier?: PlatformSupplierRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(supplier?.name ?? '');
  const [city, setCity] = useState(supplier?.city ?? '');
  const [country, setCountry] = useState(supplier?.country ?? 'GH');
  const [currency, setCurrency] = useState('GHS');
  const [description, setDescription] = useState(supplier?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim() || !city.trim()) {
      setError('Give the supplier a name and city.');
      return;
    }
    setSaving(true);
    setError(null);
    const result =
      mode === 'create'
        ? await catalogService.createSupplierAsPlatformAdmin({ name: name.trim(), city: city.trim(), country, currency, description } as NewPlatformSupplierInput)
        : await catalogService.updateSupplierAsPlatformAdmin(supplier!.id, { name: name.trim(), city: city.trim(), country, description });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    toast.show(mode === 'create' ? `${name} created.` : `${name} updated.`, 'success');
    onSaved();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'Add supplier' : 'Edit supplier'}
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving}>
            {mode === 'create' ? 'Create supplier' : 'Save changes'}
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
        {mode === 'create' && (
          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Dialog>
  );
}
