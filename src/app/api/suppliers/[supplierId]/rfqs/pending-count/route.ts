import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { getRfqPendingCountForSupplier } from '@/server/services/procurement.service';
import { withErrorHandling } from '@/server/errors';

/** Supplier-dashboard stat, computed via a real database count (Phase 19) - replaces a
 *  client-side `.filter().length` over the entire unpaginated RFQ list. */
export const GET = withErrorHandling(
  '/api/suppliers/[supplierId]/rfqs/pending-count',
  async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/rfqs/pending-count'>) => {
    const { supplierId } = await ctx.params;
    const access = await requireSupplierAccess(request, supplierId);
    if (!access.ok) return access.response;

    const result = await getRfqPendingCountForSupplier(supplierId);
    return NextResponse.json({ count: result.ok ? result.data : 0 });
  },
);
