import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { getInvoiceAgingSummaryForSupplier } from '@/server/services/invoices.service';
import { withErrorHandling } from '@/server/errors';

const EMPTY = { current: 0, overdue1to30: 0, overdue31to60: 0, overdue61to90: 0, overdue90plus: 0, total: 0, count: 0, overdueCount: 0, overdueAmount: 0 };

/** Real database aggregation over the supplier's outstanding invoices (Phase 19) - replaces the
 *  balance-sheet page's/dashboards' own client-side `.reduce()` over the *entire* invoice
 *  history, which broke once that list became paginated. */
export const GET = withErrorHandling(
  '/api/suppliers/[supplierId]/invoices/aging-summary',
  async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/invoices/aging-summary'>) => {
    const { supplierId } = await ctx.params;
    const access = await requireSupplierAccess(request, supplierId);
    if (!access.ok) return access.response;

    const result = await getInvoiceAgingSummaryForSupplier(supplierId);
    return NextResponse.json(result.ok ? result.data : EMPTY);
  },
);
