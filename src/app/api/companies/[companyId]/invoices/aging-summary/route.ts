import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { getInvoiceAgingSummary } from '@/server/services/invoices.service';
import { withErrorHandling } from '@/server/errors';

const EMPTY = { current: 0, overdue1to30: 0, overdue31to60: 0, overdue61to90: 0, overdue90plus: 0, total: 0, count: 0, overdueCount: 0, overdueAmount: 0 };

/** Real database aggregation over the company's outstanding invoices (Phase 19) - replaces the
 *  balance-sheet page's/dashboards' own client-side `.reduce()` over the *entire* invoice
 *  history, which broke once that list became paginated. */
export const GET = withErrorHandling(
  '/api/companies/[companyId]/invoices/aging-summary',
  async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/invoices/aging-summary'>) => {
    const { companyId } = await ctx.params;
    const access = await requireCompanyAccess(request, companyId);
    if (!access.ok) return access.response;

    const result = await getInvoiceAgingSummary(companyId);
    return NextResponse.json(result.ok ? result.data : EMPTY);
  },
);
