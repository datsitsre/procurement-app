'use client';

import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { auditLogService } from '@/services/audit-log.service';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDateTime } from '@/utils/format';
import type { AuditEntry } from '@/types/common';

const PAGE_SIZE = 25;

export default function AdminAuditPage() {
  return (
    <AdminGuard>
      <AuditLog />
    </AdminGuard>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    auditLogService.listEntries(null, PAGE_SIZE).then((result) => {
      if (result.ok) {
        setEntries(result.data.items);
        setNextCursor(result.data.nextCursor);
        setHasNext(result.data.hasNext);
      }
    });
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const result = await auditLogService.listEntries(nextCursor, PAGE_SIZE);
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
          A record of platform-administration actions - supplier verifications, product moderation decisions, and dispute
          resolutions.
        </p>
      </div>

      {entries === null ? (
        <SkeletonTable rows={6} columns={4} />
      ) : entries.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No activity yet" description="Platform administration actions will be recorded here." />
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
