import type { AuditEntry } from '@/types/common';

/** Fictional platform audit history (section 48/62). This is what a real backend's audit
 *  middleware would have recorded before Phase 6 - the log itself only starts actively
 *  recording new entries once auditLogService is wired into an action (see the platform-admin
 *  actions in catalog.service.ts, orders.service.ts's disputes, etc.), so these seed rows exist
 *  to show what the history looks like once it has some age to it, not to claim the log has
 *  captured every action the app has ever taken. */
export const demoAuditEntries: AuditEntry[] = [
  {
    id: 'audit-1',
    actorId: 'user-grace-owusu',
    actorName: 'Grace Owusu',
    action: 'SUPPLIER_VERIFIED',
    entityType: 'Supplier',
    entityId: 'supplier-abc',
    previousValue: { verification: 'PENDING_VERIFICATION' },
    newValue: { verification: 'VERIFIED' },
    timestamp: '2024-06-03T11:00:00Z',
  },
  {
    id: 'audit-2',
    actorId: 'user-grace-owusu',
    actorName: 'Grace Owusu',
    action: 'SUPPLIER_VERIFIED',
    entityType: 'Supplier',
    entityId: 'supplier-aie',
    previousValue: { verification: 'PENDING_VERIFICATION' },
    newValue: { verification: 'PREMIUM_VERIFIED' },
    timestamp: '2024-05-22T09:30:00Z',
  },
  {
    id: 'audit-3',
    actorId: 'user-grace-owusu',
    actorName: 'Grace Owusu',
    action: 'DISPUTE_RESOLVED',
    entityType: 'Dispute',
    entityId: 'dispute-2',
    previousValue: { status: 'UNDER_REVIEW' },
    newValue: { status: 'RESOLVED_REFUND' },
    timestamp: '2026-07-30T14:00:00Z',
  },
];
