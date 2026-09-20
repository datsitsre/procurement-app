import { NextResponse, type NextRequest } from 'next/server';
import { Permission, Role } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { parseCursorPagination } from '@/server/pagination';
import { listAuditLog } from '@/server/services/audit.service';
import { withErrorHandling } from '@/server/errors';

/** The platform-wide audit trail (Phase 17, section 12 - Phase 25 split by role). Cursor-
 *  paginated (?cursor=&pageSize=, default 25, max 100) - an append-only feed across every
 *  tenant, the same shape as notifications.
 *
 *  A PLATFORM_MANAGER's own view is restricted to platform-action entries (no `companyId`) -
 *  it never receives another company's transaction audit history, matching this role's own
 *  permission scope everywhere else. Only PLATFORM_SUPER_ADMIN (and the legacy PLATFORM_ADMIN)
 *  see the unfiltered, cross-company feed - see /api/companies/[companyId]/audit-log for the
 *  tenant-scoped equivalent a company's own admins use instead. */
export const GET = withErrorHandling("/api/audit-log", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_AUDIT_VIEW);
  if (!access.ok) return access.response;

  const scope = access.auth.role === Role.PLATFORM_MANAGER ? 'platform' : 'all';
  const pagination = parseCursorPagination(request);
  const companyId = request.nextUrl.searchParams.get('companyId') ?? undefined;
  const result = await listAuditLog(pagination, scope, companyId);
  return NextResponse.json(result.ok ? result.data : { items: [], nextCursor: null, hasNext: false });
});
