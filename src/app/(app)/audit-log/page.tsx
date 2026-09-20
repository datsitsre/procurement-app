'use client';

import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useActiveCompany } from '@/hooks/useAuth';
import { auditLogService } from '@/services/audit-log.service';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDateTime } from '@/utils/format';
import type { AuditEntry } from '@/types/common';

const PAGE_SIZE = 25;

/**
 * A company's own audit trail (section 6/12/28) - team/role changes, approval decisions, quote
 * acceptance. Distinct from the platform-wide feed at /admin/audit: this calls
 * GET /api/companies/[companyId]/audit-log, which is tenant-checked server-side the same way
 * every other companies/[companyId]/* route is, so this page can never show another company's
 * entries no matter what this component does or doesn't render - the nav item (gated on
 * `audit.view`, config/navigation.ts) is a UX convenience, the route is the real boundary.
 */
export default function AuditLogPage() {
  const company = useActiveCompany();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!company) return;
    auditLogService.listCompanyEntries(company.id, null, PAGE_SIZE).then((result) => {
      if (result.ok) {
        setEntries(result.data.items);
        setNextCursor(result.data.nextCursor);
        setHasNext(result.data.hasNext);
      } else {
        setError(result.error.message);
      }
    });
  }, [company]);

  async function loadMore() {
    if (!nextCursor || !company) return;
    setLoadingMore(true);
    const result = await auditLogService.listCompanyEntries(company.id, nextCursor, PAGE_SIZE);
    if (result.ok) {
      setEntries((prev) => [...(prev ?? []), ...result.data.items]);
      setNextCursor(result.data.nextCursor);
      setHasNext(result.data.hasNext);
    }
    setLoadingMore(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Audit log</h1>
        <p className="text-body text-text-secondary">
          A record of sensitive actions taken on {company?.name ?? 'your company'}&rsquo;s account - team/role
          changes, approval decisions, and quote acceptance.
        </p>
      </div>

      {error ? (
        <ErrorState title="Couldn't load the audit log" description={error} />
      ) : entries === null ? (
        <SkeletonTable rows={6} columns={4} />
      ) : entries.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No activity yet" description="Sensitive account actions will be recorded here." />
      ) : (
        <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
          <table className="w-full text-table">
            <thead>
              <tr className="text-metadata">
                <th className="p-4 text-left">When</th>
                <th className="p-4 text-left">Actor</th>
                <th className="p-4 text-left">Action</th>
                <th className="p-4 text-left">Entity</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="p-4 whitespace-nowrap text-text-secondary">{formatDateTime(e.timestamp)}</td>
                  <td className="p-4">{e.actorName}</td>
                  <td className="p-4">{e.action.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="p-4">
                    <span className="text-caption">
                      {e.entityType} · {e.entityId}
                    </span>
                    {(e.previousValue !== undefined || e.newValue !== undefined) && (
                      <p className="text-caption mt-1">
                        {e.previousValue !== undefined && <>from {JSON.stringify(e.previousValue)} </>}
                        {e.newValue !== undefined && <>to {JSON.stringify(e.newValue)}</>}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="flex flex-col gap-3 sm:hidden">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-medium">
                {e.actorName} · {e.action.replace(/_/g, ' ').toLowerCase()}
              </p>
              <p className="text-caption mt-1">
                {e.entityType} · {e.entityId}
              </p>
              <p className="text-caption">{formatDateTime(e.timestamp)}</p>
            </div>
          ))}
        </div>
      )}

      {hasNext && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
