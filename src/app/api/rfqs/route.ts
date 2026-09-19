import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { createRfq, listRfqs } from '@/server/services/procurement.service';
import { parsePagination } from '@/server/pagination';
import { NewRfqSchema } from '@/server/validation/procurement';
import { withErrorHandling } from '@/server/errors';

/** A buyer company's own RFQs, for the RFQ list page - `companyId` comes from the query string
 *  but is re-checked against the caller's own tenant, never trusted outright (section 6).
 *  Paginated (Phase 19, ?page=&pageSize=, default 25, max 100), matching every other
 *  tenant-scoped list endpoint. */
export const GET = withErrorHandling("/api/rfqs", async (request: NextRequest) => {
  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listRfqs(companyId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});

export const POST = withErrorHandling("/api/rfqs", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';

  const access = await requireCompanyAccess(request, companyId, Permission.RFQ_CREATE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('rfqCreate', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const parsed = NewRfqSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await createRfq({ ...parsed.data, companyId, createdByUserId: access.auth.userId });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
