import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listInvoicesForSupplier } from '@/server/services/invoices.service';
import { parsePagination } from '@/server/pagination';
import { withErrorHandling } from '@/server/errors';

/** Paginated (Phase 19, ?page=&pageSize=, default 25, max 100), matching every other
 *  tenant-scoped list endpoint. */
export const GET = withErrorHandling("/api/suppliers/[supplierId]/invoices", async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/invoices'>) => {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listInvoicesForSupplier(supplierId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});
