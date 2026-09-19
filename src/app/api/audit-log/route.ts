import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { parseCursorPagination } from '@/server/pagination';
import { listAuditLog } from '@/server/services/audit.service';
import { withErrorHandling } from '@/server/errors';

/** The platform-wide audit trail (Phase 17, section 12) - platform-admin only, matching
 *  GET /api/analytics's own gate. Cursor-paginated (?cursor=&pageSize=, default 25, max 100) -
 *  an append-only, ever-growing feed across every tenant, the same shape as notifications. */
export const GET = withErrorHandling("/api/audit-log", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const pagination = parseCursorPagination(request);
  const result = await listAuditLog(pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], nextCursor: null, hasNext: false });
});
