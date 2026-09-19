import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { listOrders } from '@/server/services/orders.service';
import { withErrorHandling } from '@/server/errors';

/** Paginated (?page=&pageSize=, default 25, max 100 - Phase 16). Tenant scoping happens inside
 *  the same query as pagination (server/services/orders.service.ts#listOrders), never after. */
export const GET = withErrorHandling("/api/companies/[companyId]/orders", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/orders'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listOrders(companyId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
