'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Activity as ActivityIcon } from 'lucide-react';
import { AdminGuard } from '@/features/admin/AdminGuard';
import { ActivityDetailsDialog } from '@/features/admin/ActivityDetailsDialog';
import { auditLogService } from '@/services/audit-log.service';
import { describeActivity, ACTIVITY_CATEGORY_LABELS, type ActivityCategory } from '@/lib/activityFeed';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { formatDateTime } from '@/utils/format';
import type { AuditEntry } from '@/types/common';

const PAGE_SIZE = 50;
type DateFilter = 'all' | 'today' | '7d' | '30d';

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function withinDateFilter(timestamp: string, filter: DateFilter): boolean {
  if (filter === 'all') return true;
  const entryTime = new Date(timestamp).getTime();
  const now = Date.now();
  const windowMs = filter === 'today' ? 24 * 60 * 60_000 : filter === '7d' ? 7 * 24 * 60 * 60_000 : 30 * 24 * 60 * 60_000;
  return now - entryTime <= windowMs;
}

/**
 * A friendlier, filterable read of the exact same platform-wide AuditLog rows GET /api/audit-log
 * already serves to /admin/audit (section 16) - never a second audit system, never a separate
 * database. Search/category/date filtering happens client-side over the currently loaded window
 * (this is a read-only convenience view, not a compliance export - /admin/audit remains the
 * authoritative, unfiltered record). "Load more" fetches further pages the same way the existing
 * Audit Log page does, via the same cursor-paginated endpoint.
 */
export default function AdminActivityPage() {
  return (
    <AdminGuard>
      <ActivityCenter />
    </AdminGuard>
  );
}

function ActivityCenter() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ActivityCategory | 'all'>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  useEffect(() => {
    auditLogService.listEntries(null, PAGE_SIZE).then((result) => {
      if (result.ok) {
        setEntries(result.data.items);
        setNextCursor(result.data.nextCursor);
        setHasNext(result.data.hasNext);
      } else {
        setError(result.error.message);
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

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      const { category: entryCategory } = describeActivity(e);
      if (category !== 'all' && entryCategory !== category) return false;
      if (!withinDateFilter(e.timestamp, dateFilter)) return false;
      if (!q) return true;
      return (
        e.actorName.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.entityType.toLowerCase().includes(q) ||
        (e.companyName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [entries, search, category, dateFilter]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1">Activity</h1>
        <p className="text-body text-text-secondary">
          An operational view of platform activity - team/role changes, approvals, and moderation decisions. For the
          full, unfiltered security record, see the <a href="/admin/audit" className="font-medium text-accent hover:underline">Audit log</a>.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1 sm:max-w-xs">
          <Input
            placeholder="Search activity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leadingIcon={<Search className="h-4 w-4" aria-hidden="true" />}
          />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory | 'all')} className="sm:w-48">
          <option value="all">All actions</option>
          {Object.entries(ACTIVITY_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)} className="sm:w-40">
          {DATE_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {error ? (
        <ErrorState title="Couldn't load activity" description={error} />
      ) : entries === null ? (
        <SkeletonTable rows={8} columns={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No activity found"
          description={entries && entries.length > 0 ? 'Try a different search or filter.' : 'Platform activity will appear here.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-table">
            <thead>
              <tr className="text-metadata">
                <th className="p-4 text-left">Actor</th>
                <th className="p-4 text-left">Action</th>
                <th className="p-4 text-left">Resource</th>
                <th className="p-4 text-left">Company</th>
                <th className="p-4 text-left">Date</th>
                <th className="p-4 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const { label, icon: Icon } = describeActivity(e);
                return (
                  <tr
                    key={e.id}
                    onClick={() => setSelected(e)}
                    className="cursor-pointer border-t border-border hover:bg-neutral-bg"
                  >
                    <td className="p-4 font-medium">{e.actorName}</td>
                    <td className="p-4">
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
                        {label}
                      </span>
                    </td>
                    <td className="p-4 text-caption">
                      {e.entityType} · {e.entityId}
                    </td>
                    <td className="p-4 text-text-secondary">{e.companyName ?? '—'}</td>
                    <td className="p-4 whitespace-nowrap text-text-secondary">{formatDateTime(e.timestamp)}</td>
                    <td className="p-4">
                      <Badge tone="success">Successful</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasNext && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}

      <ActivityDetailsDialog entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
