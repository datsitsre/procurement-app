import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { listPendingApprovals } from '@/server/services/procurement.service';
import { withErrorHandling } from '@/server/errors';

/** Purchase requests whose next pending approval step matches the caller's own role - the role
 *  comes from the caller's session, never a query param, so nobody can ask to see what a
 *  different role would see. */
export const GET = withErrorHandling("/api/companies/[companyId]/purchase-requests/pending", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-requests/pending'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_APPROVE);
  if (!access.ok) return access.response;
  if (!access.auth.role) return NextResponse.json([]);

  const result = await listPendingApprovals(companyId, access.auth.role);
  return NextResponse.json(result.ok ? result.data : []);
});
