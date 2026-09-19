import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listPayments } from '@/server/services/payment.service';
import { parsePagination } from '@/server/pagination';
import { withErrorHandling } from '@/server/errors';

/** Paginated (Phase 19, ?page=&pageSize=, default 25, max 100), matching every other
 *  tenant-scoped list endpoint. */
export const GET = withErrorHandling("/api/companies/[companyId]/payments", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/payments'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listPayments(companyId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
