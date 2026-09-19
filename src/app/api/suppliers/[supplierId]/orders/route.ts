import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { listOrdersForSupplier } from '@/server/services/orders.service';
import { withErrorHandling } from '@/server/errors';

/** Orders a supplier needs to fulfill (section 44) - the supplier-workspace counterpart to
 *  GET /api/companies/[companyId]/orders. Paginated (Phase 16). */
export const GET = withErrorHandling("/api/suppliers/[supplierId]/orders", async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/orders'>) => {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listOrdersForSupplier(supplierId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
