import 'server-only';
import { db } from '@/server/db';
import { checkDependencies } from '@/server/health';
import { hasPermission, Permission, Role } from '@/config/rbac';
import { listAuditLog } from './audit.service';
import type { AuditEntry, UUID } from '@/types/common';

/**
 * The Platform Command Center dashboard's single data source (/admin, GET /api/admin/overview).
 * Every section below is computed only when the caller's real, session-derived role actually
 * holds the permission that section's own dedicated page/route already requires - never derived
 * from anything the client sends, and never "fetch everything, filter in the UI." A
 * PLATFORM_MANAGER calling this gets `companies: undefined` (the whole key is absent from the
 * JSON, not a zeroed-out placeholder that looks like real data), exactly mirroring that
 * `companies` requires PLATFORM_COMPANIES_VIEW, which PLATFORM_MANAGER does not hold (see
 * rbac.ts's RolePermissions) - the same boundary GET /api/admin/companies itself enforces.
 *
 * Every count here is a real `db.*.count()` aggregate, never a full-table fetch filtered in
 * memory - see this file's own functions for the exact `where` each metric is defined by.
 */

export interface CountBreakdown {
  total: number;
  active: number;
  suspended: number;
}

export interface SupplierBreakdown {
  total: number;
  verified: number;
  pendingVerification: number;
  suspended: number;
}

export interface PendingApprovalPreview {
  userId: UUID;
  userName: string;
  companyId: UUID;
  companyName: string;
  submittedAt: string;
}

export interface ApprovalsOverview {
  total: number;
  items: PendingApprovalPreview[];
}

export interface SystemStatus {
  /** The only genuine backend check that exists today (src/server/health.ts's checkDependencies -
   *  the same one GET /api/health and GET /api/ready already use) - a raw `SELECT 1`. Never
   *  reports 'healthy' without having actually run this query moments ago. */
  database: 'healthy' | 'unavailable';
  /** True by construction, not measured: if this response is being generated at all, the API
   *  layer that generated it is self-evidently serving requests. Deliberately NOT accompanied by
   *  an "Authentication" or "Background Jobs" card - no monitoring exists anywhere in this app
   *  for either (no session-failure-rate tracking, no cron/queue health reporting), and inventing
   *  a status for something never actually checked is exactly what this dashboard must not do. */
  api: 'healthy';
}

export interface PlatformOverview {
  role: Role;
  /** Buyer companies only (isBuyer: true), matching GET /api/admin/companies's own filter -
   *  present only for PLATFORM_COMPANIES_VIEW holders (Super Admin/legacy Admin). */
  companies?: CountBreakdown;
  /** Present for PLATFORM_CATALOG_MODERATE holders (both platform roles). */
  suppliers?: SupplierBreakdown;
  /** Every registered user platform-wide. A user has no single cross-company status (only each
   *  CompanyMembership does - see platformUsers.service.ts's own comment on this), so `active`
   *  means "holds at least one ACTIVE membership" and `suspended` means "holds no ACTIVE
   *  membership and at least one SUSPENDED one" - a user is never counted in both. Present for
   *  PLATFORM_USERS_MANAGE holders (both platform roles). */
  users?: CountBreakdown;
  /** Present for PLATFORM_REGISTRATION_APPROVE holders (both platform roles). The only kind of
   *  "pending approval" this app has is a self-registered company's founding OWNER membership
   *  (CompanyMembership.status === PENDING_APPROVAL, decided via decideRegistration) - there is
   *  no separate supplier-registration or user-registration approval concept to also surface
   *  here (confirmed: PENDING_APPROVAL only ever appears on that one kind of membership). */
  approvals?: ApprovalsOverview;
  /** The 8 most recent platform-wide audit entries, via the exact same listAuditLog scope logic
   *  GET /api/audit-log already uses (platform-scoped for PLATFORM_MANAGER, unfiltered for Super
   *  Admin/legacy Admin) - present for PLATFORM_AUDIT_VIEW holders (both platform roles). */
  activity?: AuditEntry[];
  systemStatus: SystemStatus;
}

async function getCompanyBreakdown(): Promise<CountBreakdown> {
  const [active, suspended] = await Promise.all([
    db.company.count({ where: { isBuyer: true, status: 'ACTIVE' } }),
    db.company.count({ where: { isBuyer: true, status: 'SUSPENDED' } }),
  ]);
  return { total: active + suspended, active, suspended };
}

async function getSupplierBreakdown(): Promise<SupplierBreakdown> {
  const [verified, premiumVerified, pendingVerification, suspended, rejected] = await Promise.all([
    db.supplierProfile.count({ where: { verification: 'VERIFIED' } }),
    db.supplierProfile.count({ where: { verification: 'PREMIUM_VERIFIED' } }),
    db.supplierProfile.count({ where: { verification: 'PENDING_VERIFICATION' } }),
    db.supplierProfile.count({ where: { verification: 'SUSPENDED' } }),
    db.supplierProfile.count({ where: { verification: 'REJECTED' } }),
  ]);
  const verifiedTotal = verified + premiumVerified;
  return { total: verifiedTotal + pendingVerification + suspended + rejected, verified: verifiedTotal, pendingVerification, suspended };
}

async function getUserBreakdown(): Promise<CountBreakdown> {
  const [total, active, suspendedOnly] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { memberships: { some: { status: 'ACTIVE' } } } }),
    db.user.count({
      where: { AND: [{ memberships: { some: { status: 'SUSPENDED' } } }, { memberships: { none: { status: 'ACTIVE' } } }] },
    }),
  ]);
  return { total, active, suspended: suspendedOnly };
}

async function getPendingApprovals(): Promise<ApprovalsOverview> {
  const [total, rows] = await Promise.all([
    db.companyMembership.count({ where: { status: 'PENDING_APPROVAL' } }),
    db.companyMembership.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: { select: { name: true } }, company: { select: { name: true } } },
    }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      userId: r.userId,
      userName: r.user.name,
      companyId: r.companyId,
      companyName: r.company.name,
      submittedAt: r.createdAt.toISOString(),
    })),
  };
}

async function getRecentActivity(role: Role): Promise<AuditEntry[]> {
  const scope = role === Role.PLATFORM_MANAGER ? 'platform' : 'all';
  const result = await listAuditLog({ cursor: null, take: 8 }, scope);
  return result.ok ? result.data.items : [];
}

/** Runs one section's query, but a failure here never takes down the other, independent
 *  sections in the same response (Phase 10 - "one forbidden/failed request must not fail the
 *  whole dashboard"). Logged server-side; the client sees that section simply absent, the same
 *  shape a permission-denied section already has - an acceptable trade-off over a richer
 *  error-vs-omitted distinction, given every section here is a cheap, independent read. */
async function safely<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error('[platformOverview] section query failed', err);
    return undefined;
  }
}

export async function getPlatformOverview(actor: { role: Role }): Promise<PlatformOverview> {
  const { role } = actor;

  const [companies, suppliers, users, approvals, activity, health] = await Promise.all([
    hasPermission(role, Permission.PLATFORM_COMPANIES_VIEW) ? safely(getCompanyBreakdown) : Promise.resolve(undefined),
    hasPermission(role, Permission.PLATFORM_CATALOG_MODERATE) ? safely(getSupplierBreakdown) : Promise.resolve(undefined),
    hasPermission(role, Permission.PLATFORM_USERS_MANAGE) ? safely(getUserBreakdown) : Promise.resolve(undefined),
    hasPermission(role, Permission.PLATFORM_REGISTRATION_APPROVE) ? safely(getPendingApprovals) : Promise.resolve(undefined),
    hasPermission(role, Permission.PLATFORM_AUDIT_VIEW) ? safely(() => getRecentActivity(role)) : Promise.resolve(undefined),
    checkDependencies(),
  ]);

  return {
    role,
    companies,
    suppliers,
    users,
    approvals,
    activity,
    systemStatus: { database: health.checks.database === 'ok' ? 'healthy' : 'unavailable', api: 'healthy' },
  };
}
