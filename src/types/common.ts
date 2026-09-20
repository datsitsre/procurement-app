/** Shared primitive types used across every domain model. */

/** All entity IDs are UUIDs (never predictable sequential integers) - see section 48 of the
 *  product brief. Public-facing reference numbers (e.g. "PO-2026-00182") are a separate,
 *  human-readable display field, not the primary key. */
export type UUID = string;

export type ISODateTime = string;

export type CurrencyCode = 'GHS' | 'NGN' | 'KES' | 'ZAR' | 'XOF' | 'USD';

export type CountryCode = 'GH' | 'NG' | 'KE' | 'ZA' | 'CI';

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export interface Address {
  id: UUID;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  country: CountryCode;
  postalCode?: string;
  isDefault?: boolean;
}

/** A single point in an audit trail - see AuditLog in section 48/62. */
export interface AuditEntry {
  id: UUID;
  actorId: UUID;
  actorName: string;
  action: string;
  entityType: string;
  entityId: UUID;
  previousValue?: unknown;
  newValue?: unknown;
  timestamp: ISODateTime;
  ipAddress?: string;
  /** Set only on the platform-wide feed (GET /api/audit-log) - a company-transaction-shaped
   *  entry's own company, resolved via AuditLog's existing `company` relation. Never set on the
   *  already-company-scoped GET /api/companies/[companyId]/audit-log, since every row there
   *  already belongs to the one company the caller asked about. */
  companyId?: UUID;
  companyName?: string;
}

/** Standard paginated list envelope every list-returning service method resolves to. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Cursor-paginated list envelope for append-only feeds (notifications, ...) where an offset is
 *  the wrong fit - see server/pagination.ts's `toCursorPage`, which produces this same shape
 *  server-side. Declared here (rather than only in server/pagination.ts, which is `server-only`)
 *  so client services can use the type without importing a server-only module. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasNext: boolean;
}

/** Standard shape for a failed service/API call - components branch on `ok`. */
export interface ServiceError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError };

/**
 * Who is calling, for tenant-ownership checks (section 9.2) - distinct from `Role`, which only
 * says what *type* of action the caller may perform, never which company's records they may
 * see. A `get<Entity>ById` fetched by a URL path segment is exactly the shape of an IDOR: the
 * id is attacker-controlled, so every such lookup must verify the record actually belongs to
 * this caller before returning it, not just that the record exists. See
 * services/base.ts's `ownsRecord` and hooks/useAuth.tsx's `useTenantContext`.
 */
export interface TenantContext {
  companyId?: UUID;
  supplierId?: UUID;
  isPlatformAdmin?: boolean;
}
