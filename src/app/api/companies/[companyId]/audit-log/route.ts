import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { parseCursorPagination } from '@/server/pagination';
import { listCompanyAuditLog } from '@/server/services/audit.service';
import { withErrorHandling } from '@/server/errors';

/** A company's own audit trail (section 28 - "Company A users must not see Company B audit
 *  records"). Distinct from GET /api/audit-log (the platform-wide feed) - this route only ever
 *  returns rows for the caller's own session-derived company, via the same requireCompanyAccess
 *  tenant check every other company-scoped route uses; a Company A owner can never pass Company
 *  B's id here and see Company B's entries. Gated on AUDIT_VIEW (granted to OWNER/ADMIN/
 *  SUPPLIER_ADMIN - the same roles that already hold SETTINGS_MANAGE). */
export const GET = withErrorHandling("/api/companies/[companyId]/audit-log", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/audit-log'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.AUDIT_VIEW);
  if (!access.ok) return access.response;

  const pagination = parseCursorPagination(request);
  const result = await listCompanyAuditLog(companyId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], nextCursor: null, hasNext: false });
});
