import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireSupplierAccess } from '@/server/auth/require';
import { createProduct, listProducts, type ProductFilters } from '@/server/services/catalog.service';
import { NewProductSchema } from '@/server/validation/catalog';

/** Public read - the buyer-facing catalog (only PUBLISHED listings; see listProducts). No
 *  auth required, matching the mock's listProducts(), which never checked one either. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const filters: ProductFilters = {
    categorySlug: searchParams.get('categorySlug') ?? undefined,
    supplierId: searchParams.get('supplierId') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    minPrice: searchParams.has('minPrice') ? Number(searchParams.get('minPrice')) : undefined,
    maxPrice: searchParams.has('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined,
    sortBy: (searchParams.get('sortBy') as ProductFilters['sortBy']) ?? undefined,
  };
  const result = await listProducts(filters);
  return NextResponse.json(result.ok ? result.data : []);
}

export async function POST(request: NextRequest) {
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
}
