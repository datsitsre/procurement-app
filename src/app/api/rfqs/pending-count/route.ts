import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { getRfqPendingCount } from '@/server/services/procurement.service';
import { withErrorHandling } from '@/server/errors';

/** Buyer-dashboard stat, computed via a real database count (Phase 19) - replaces a client-side
 *  `.filter().length` over the entire unpaginated RFQ list, matching the same pattern
 *  `getSupplierOrdersToFulfillCount` already established for orders. */
export const GET = withErrorHandling('/api/rfqs/pending-count', async (request: NextRequest) => {
  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await getRfqPendingCount(companyId);
  return NextResponse.json({ count: result.ok ? result.data : 0 });
});
