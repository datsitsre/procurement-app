'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Plus, Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { useAsyncData } from '@/hooks/useAsyncData';
import { companyService, type NewPlatformCompanyInput, type PlatformCompanyRow } from '@/services/company.service';
import { Permission } from '@/config/rbac';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/utils/format';

type SortKey = 'name' | 'country' | 'members' | 'created';
const COUNTRY_OPTIONS = ['GH', 'NG', 'KE', 'ZA', 'CI'];
const CURRENCY_OPTIONS = ['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'USD'];

/** Real backend data (Phase 26 follow-up) - GET /api/admin/companies, now gated on the
 *  dedicated PLATFORM_COMPANIES_VIEW permission (Phase 28) rather than
 *  PLATFORM_TRANSACTIONS_ACCESS - same roles pass either way (Super Admin/legacy Admin only).
 *  Create (Phase 28, POST /api/admin/companies) and Edit (PATCH /api/admin/companies/[id]) are
 *  real, permission-gated actions - hidden entirely when `can()` says no, and independently
 *  re-checked server-side regardless. "View" links to the Company Detail page
 *  (/admin/companies/[companyId]), which itself only shows what its own routes securely permit -
 *  including Suspend/Activate (PLATFORM_COMPANIES_SUSPEND/ACTIVATE), kept on that page rather
 *  than duplicated here so there's exactly one place a status transition can be triggered from.
 *  Delete is NOT implemented and never will be here - a company's business records (orders,
 *  invoices, payments) must never be destroyable; suspension is the platform's only lifecycle
 *  lever for a company that needs to be cut off. */
export default function AdminCompaniesPage() {
  return (
    <AdminGuard>
      <CompaniesDirectory />
    </AdminGuard>
  );
}

function CompaniesDirectory() {
  const { can } = useAuth();
  const { data: companies, loading, error, reload } = useAsyncData<PlatformCompanyRow[]>('admin-companies', () => companyService.listAllCompanies());
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('all');
  const [sort, setSort] = useState<SortKey>('created');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformCompanyRow | null>(null);

  const countries = useMemo(() => Array.from(new Set(companies?.map((c) => c.country) ?? [])).sort(), [companies]);

  const filtered = useMemo(() => {
    if (!companies) return [];
    const q = search.trim().toLowerCase();
    const list = companies.filter((c) => (country === 'all' || c.country === country) && (!q || c.name.toLowerCase().includes(q)));
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'country') return a.country.localeCompare(b.country);
      if (sort === 'members') return b.memberCount - a.memberCount;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [companies, search, country, sort]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1">Companies</h1>
          <p className="text-body text-text-secondary">Manage organizations registered on the platform.</p>
        </div>
        {can(Permission.PLATFORM_COMPANIES_CREATE) && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add company
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState title="Couldn't load the company directory" description={error} />
      ) : loading ? (
        <SkeletonTable rows={6} columns={6} />
      ) : !companies || companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies yet" description="Buyer companies that register will appear here." />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 sm:max-w-xs">
              <Input
                placeholder="Search companies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leadingIcon={<Search className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
            <Select value={country} onChange={(e) => setCountry(e.target.value)} className="sm:w-40">
              <option value="all">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sm:w-44">
              <option value="created">Newest first</option>
              <option value="name">Name (A-Z)</option>
              <option value="country">Country</option>
              <option value="members">Most members</option>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Search} title="No companies match" description="Try a different search or country filter." />
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
                <table className="w-full text-table">
                  <thead>
                    <tr className="text-metadata">
                      <th className="p-4 text-left">Company</th>
                      <th className="p-4 text-left">Country</th>
                      <th className="p-4 text-left">Currency</th>
                      <th className="p-4 text-left">Status</th>
                      <th className="p-4 text-right">Members</th>
                      <th className="p-4 text-left">Created</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="p-4 font-medium">{c.name}</td>
                        <td className="p-4">{c.country}</td>
                        <td className="p-4">{c.currency}</td>
                        <td className="p-4">
                          <StatusBadge domain="company" status={c.status} />
                        </td>
                        <td className="p-4 text-right">{c.memberCount}</td>
                        <td className="p-4 text-text-secondary">{formatDate(c.createdAt)}</td>
                        <td className="p-4">
                          <div className="flex justify-end gap-2">
                            <Link href={`/admin/companies/${c.id}`}>
                              <Button variant="outline" size="sm">
                                View
                              </Button>
                            </Link>
                            {can(Permission.PLATFORM_COMPANIES_UPDATE) && (
                              <Button variant="outline" size="sm" onClick={() => setEditing(c)}>
                                Edit
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 sm:hidden">
                {filtered.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{c.name}</p>
                          <StatusBadge domain="company" status={c.status} />
                        </div>
                        <p className="text-caption mt-1">
                          {c.country} · {c.currency} · {c.creditTerms.replace('_', ' ')}
                        </p>
                        <p className="text-caption">
                          {c.memberCount} members · created {formatDate(c.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Link href={`/admin/companies/${c.id}`}>
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                        </Link>
                        {can(Permission.PLATFORM_COMPANIES_UPDATE) && (
                          <Button variant="outline" size="sm" onClick={() => setEditing(c)}>
                            Edit
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <CompanyFormDialog
        open={creating}
        mode="create"
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          reload();
        }}
      />
      <CompanyFormDialog
        key={editing?.id ?? 'no-edit'}
        open={!!editing}
        mode="edit"
        company={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    </div>
  );
}

function CompanyFormDialog({
  open,
  mode,
  company,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  company?: PlatformCompanyRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(company?.name ?? '');
  const [country, setCountry] = useState(company?.country ?? 'GH');
  const [currency, setCurrency] = useState(company?.currency ?? 'GHS');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) {
      setError('Give the company a name.');
      return;
    }
    setSaving(true);
    setError(null);
    const input: NewPlatformCompanyInput = { name: name.trim(), country, currency };
    const result =
      mode === 'create'
        ? await companyService.createCompany(input)
        : await companyService.updateCompanyAsPlatformAdmin(company!.id, input);
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
      title={mode === 'create' ? 'Add company' : 'Edit company'}
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving}>
            {mode === 'create' ? 'Create company' : 'Save changes'}
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
