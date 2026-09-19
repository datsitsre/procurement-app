import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listRfqsForSupplier } from '@/server/services/procurement.service';
import { parsePagination } from '@/server/pagination';
import { withErrorHandling } from '@/server/errors';

/** RFQs a supplier has been invited to, for the supplier-side RFQ inbox. Paginated (Phase 19,
 *  ?page=&pageSize=, default 25, max 100), matching every other tenant-scoped list endpoint. */
export const GET = withErrorHandling("/api/suppliers/[supplierId]/rfqs", async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/rfqs'>) => {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listRfqsForSupplier(supplierId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
