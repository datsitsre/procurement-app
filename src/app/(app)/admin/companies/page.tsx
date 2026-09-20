'use client';

import { Building2 } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { useAsyncData } from '@/hooks/useAsyncData';
import { companyService, type PlatformCompanyRow } from '@/services/company.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDate } from '@/utils/format';

export default function AdminCompaniesPage() {
  return (
    <AdminGuard>
      <CompaniesDirectory />
    </AdminGuard>
  );
}

/** Real backend data (Phase 26 follow-up) - GET /api/admin/companies, gated server-side to
 *  PLATFORM_TRANSACTIONS_ACCESS (PLATFORM_SUPER_ADMIN/legacy PLATFORM_ADMIN only). Previously
 *  read from `allCompanies()`, a frontend-only localStorage cache that could show stale or
 *  incomplete data instead of the real production company roster - AdminGuard hiding this page
 *  from other workspaces was never the reason this call is safe; the route's own permission
 *  check is, and a PLATFORM_MANAGER hitting this endpoint directly still gets a real 403. */
function CompaniesDirectory() {
  const { data: companies, loading, error } = useAsyncData<PlatformCompanyRow[]>('admin-companies', () => companyService.listAllCompanies());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Companies</h1>
        <p className="text-body text-text-secondary">Every buyer company registered on the platform.</p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load the company directory" description={error} />
      ) : loading ? (
        <SkeletonTable rows={6} columns={6} />
      ) : !companies || companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies yet" description="Buyer companies that register will appear here." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-table">
              <thead>
                <tr className="text-metadata">
                  <th className="p-4 text-left">Company</th>
                  <th className="p-4 text-left">Country</th>
                  <th className="p-4 text-left">Currency</th>
                  <th className="p-4 text-left">Payment terms</th>
                  <th className="p-4 text-right">Members</th>
                  <th className="p-4 text-left">Joined</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-4 font-medium">{c.name}</td>
                    <td className="p-4">{c.country}</td>
                    <td className="p-4">{c.currency}</td>
                    <td className="p-4">{c.creditTerms.replace('_', ' ')}</td>
                    <td className="p-4 text-right">{c.memberCount}</td>
                    <td className="p-4 text-text-secondary">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {companies.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="text-caption mt-1">
                  {c.country} · {c.currency} · {c.creditTerms.replace('_', ' ')}
                </p>
                <p className="text-caption">
                  {c.memberCount} members · joined {formatDate(c.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
