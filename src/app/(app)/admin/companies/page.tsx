'use client';

import { Building2 } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { allCompanies, allCompanyUsers } from '@/services/auth.service';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate } from '@/utils/format';

export default function AdminCompaniesPage() {
  return (
    <AdminGuard>
      <CompaniesDirectory />
    </AdminGuard>
  );
}

function CompaniesDirectory() {
  const companies = allCompanies().filter((c) => c.isBuyer);
  const companyUsers = allCompanyUsers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Companies</h1>
        <p className="text-body text-text-secondary">Every buyer company registered on the platform.</p>
      </div>

      {companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies yet" description="Buyer companies that register will appear here." />
      ) : (
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
                  <td className="p-4 text-right">{companyUsers.filter((cu) => cu.companyId === c.id).length}</td>
                  <td className="p-4 text-text-secondary">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {companies.length > 0 && (
        <div className="flex flex-col gap-3 sm:hidden">
          {companies.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-semibold">{c.name}</p>
              <p className="text-caption mt-1">
                {c.country} · {c.currency} · {c.creditTerms.replace('_', ' ')}
              </p>
              <p className="text-caption">
                {companyUsers.filter((cu) => cu.companyId === c.id).length} members · joined {formatDate(c.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
