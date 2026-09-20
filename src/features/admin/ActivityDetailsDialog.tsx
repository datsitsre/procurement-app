'use client';

import { Dialog } from '@/components/ui/Dialog';
import { describeActivity } from '@/lib/activityFeed';
import { formatDateTime } from '@/utils/format';
import type { AuditEntry } from '@/types/common';

export interface ActivityDetailsDialogProps {
  entry: AuditEntry | null;
  onClose: () => void;
}

/** Renders exactly the fields a real AuditLog row has - never a fabricated field. `previousValue`/
 *  `newValue` are free-form JSON set by whichever service recorded the entry (see
 *  server/services/*.ts's own `recordAudit` calls) - shown as plain key/value pairs rather than
 *  guessing a fixed "Previous role"/"New role" shape that wouldn't fit every action type. Every
 *  audit entry represents a completed action (`recordAudit` is only ever called after the
 *  underlying change succeeded - there is no "failed action" audit record in this system), so
 *  Result is always "Successful", not a fabricated status. */
export function ActivityDetailsDialog({ entry, onClose }: ActivityDetailsDialogProps) {
  if (!entry) return null;
  const { label } = describeActivity(entry);

  return (
    <Dialog open={!!entry} onClose={onClose} title="Activity details" description={label} size="sm">
      <dl className="flex flex-col gap-3 text-sm">
        <Row label="Actor" value={entry.actorName} />
        <Row label="Action" value={entry.action.replace(/_/g, ' ')} />
        <Row label="Resource" value={`${entry.entityType} · ${entry.entityId}`} />
        {entry.companyName && <Row label="Company" value={entry.companyName} />}
        {entry.previousValue !== undefined && <Row label="Before" value={formatValue(entry.previousValue)} mono />}
        {entry.newValue !== undefined && <Row label="After" value={formatValue(entry.newValue)} mono />}
        <Row label="Timestamp" value={formatDateTime(entry.timestamp)} />
        <Row label="Result" value="Successful" />
      </dl>
    </Dialog>
  );
}

function formatValue(value: unknown): string {
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');
  }
  return String(value);
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={mono ? 'text-right font-mono text-xs' : 'text-right font-medium'}>{value}</dd>
    </div>
  );
}
