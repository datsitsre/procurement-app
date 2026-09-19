import { NextResponse, type NextRequest } from 'next/server';
import { listSuppliers, type SupplierFilters } from '@/server/services/catalog.service';
import { withErrorHandling } from '@/server/errors';

/** Public read - the buyer-facing supplier directory (only VERIFIED/PREMIUM_VERIFIED; see
 *  listSuppliers). No auth required, matching GET /api/products's own "no auth" precedent -
 *  browsing suppliers is no more sensitive than browsing products. */
export const GET = withErrorHandling("/api/suppliers", async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const filters: SupplierFilters = {
    category: searchParams.get('category') ?? undefined,
    search: searchParams.get('search') ?? undefined,
  };
  const result = await listSuppliers(filters);
  return NextResponse.json(result.ok ? result.data : []);
});
