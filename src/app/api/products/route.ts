import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireSupplierAccess } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { createProduct, listProducts, type ProductFilters } from '@/server/services/catalog.service';
import { NewProductSchema } from '@/server/validation/catalog';
import { withErrorHandling } from '@/server/errors';

/** Public read - the buyer-facing catalog (only PUBLISHED listings; see listProducts). No
 *  auth required, matching the mock's listProducts(), which never checked one either.
 *  Paginated (?page=&pageSize=, default 25, max 500 - Phase 17, section 11). The max is higher
 *  than every other paginated endpoint's 100 (see `src/server/pagination.ts`'s default) because
 *  this same endpoint also backs the RFQ-creation product picker (a single-select dropdown that
 *  needs "all" products to choose from, not a page of them) - see
 *  `src/app/(app)/rfqs/create/page.tsx`'s own comment on the cap this implies. */
export const GET = withErrorHandling("/api/products", async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const filters: ProductFilters = {
    categorySlug: searchParams.get('categorySlug') ?? undefined,
    supplierId: searchParams.get('supplierId') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    minPrice: searchParams.has('minPrice') ? Number(searchParams.get('minPrice')) : undefined,
    maxPrice: searchParams.has('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined,
    sortBy: (searchParams.get('sortBy') as ProductFilters['sortBy']) ?? undefined,
  };
  const pagination = parsePagination(request, { maxPageSize: 500 });
  const result = await listProducts(filters, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});

export const POST = withErrorHandling("/api/products", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const supplierId = typeof body?.supplierId === 'string' ? body.supplierId : '';

  // `caller.supplierId` must match `supplierId` (section 9.2) - otherwise any supplier account
  // could create a listing attributed to a competitor's supplier id.
  const access = await requireSupplierAccess(request, supplierId, Permission.PRODUCTS_MANAGE);
  if (!access.ok) return access.response;

  const parsed = NewProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await createProduct({ ...parsed.data, supplierId });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
