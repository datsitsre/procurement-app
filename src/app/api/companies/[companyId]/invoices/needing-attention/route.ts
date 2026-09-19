import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { getInvoicesNeedingAttention } from '@/server/services/invoices.service';
import { withErrorHandling } from '@/server/errors';

/** The finance dashboard's own "needs attention" list (Phase 19) - the soonest-due outstanding
 *  invoices, a real bounded `orderBy`+`take` query, never a slice of the full invoice history. */
export const GET = withErrorHandling(
  '/api/companies/[companyId]/invoices/needing-attention',
  async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/invoices/needing-attention'>) => {
    const { companyId } = await ctx.params;
    const access = await requireCompanyAccess(request, companyId);
    if (!access.ok) return access.response;

    const result = await getInvoicesNeedingAttention(companyId);
    return NextResponse.json(result.ok ? result.data : []);
  },
);
