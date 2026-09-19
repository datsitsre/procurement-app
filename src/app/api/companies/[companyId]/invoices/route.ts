import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listInvoices } from '@/server/services/invoices.service';
import { parsePagination } from '@/server/pagination';
import { withErrorHandling } from '@/server/errors';

/** Paginated (Phase 19, ?page=&pageSize=, default 25, max 100), matching every other
 *  tenant-scoped list endpoint. */
export const GET = withErrorHandling("/api/companies/[companyId]/invoices", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/invoices'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listInvoices(companyId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
