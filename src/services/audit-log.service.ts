import { delay, ok } from './base';
import { demoAuditEntries } from '@/lib/demo-data/audit-log';
import type { AuditEntry, ServiceResult, UUID } from '@/types/common';

const AUDIT_STORE_KEY = 'platform.audit-log.v1.list';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function readCreated(): AuditEntry[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(AUDIT_STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AuditEntry[];
  } catch {
    return [];
  }
}

function appendCreated(entry: AuditEntry) {
  if (typeof window === 'undefined') return;
  const list = readCreated();
  list.push(entry);
  window.localStorage.setItem(AUDIT_STORE_KEY, JSON.stringify(list));
}

export type NewAuditEntry = Omit<AuditEntry, 'id' | 'timestamp'>;

export interface AuditLogService {
  listEntries(): Promise<ServiceResult<AuditEntry[]>>;
  /**
   * Records one audit entry (section 48/62). Not permission-gated itself - it's called
   * internally by other services *after* their own assertPermission check has already passed,
   * the same way a real backend's audit middleware sits behind the authorization layer rather
   * than in front of it. Every platform-admin mutation added in Phase 6 (supplier verification,
   * product moderation, dispute resolution) calls this; earlier phases' actions are not
   * retroactively logged - see demoAuditEntries's own note on this.
   */
  record(entry: NewAuditEntry): void;
}

class MockAuditLogService implements AuditLogService {
  async listEntries(): Promise<ServiceResult<AuditEntry[]>> {
    await delay(250);
    return ok([...demoAuditEntries, ...readCreated()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)));
  }

  record(entry: NewAuditEntry): void {
    appendCreated({ ...entry, id: newId('audit'), timestamp: new Date().toISOString() });
  }
}

export const auditLogService: AuditLogService = new MockAuditLogService();
