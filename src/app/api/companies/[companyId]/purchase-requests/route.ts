import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { parsePagination } from '@/server/pagination';
import { createPurchaseRequest, listPurchaseRequests } from '@/server/services/procurement.service';
import { NewPurchaseRequestSchema } from '@/server/validation/procurement';
import { withErrorHandling } from '@/server/errors';

/** Paginated (?page=&pageSize=, default 25, max 100 - Phase 16). */
export const GET = withErrorHandling("/api/companies/[companyId]/purchase-requests", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-requests'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const pagination = parsePagination(request);
  const result = await listPurchaseRequests(companyId, pagination);
  return NextResponse.json(result.ok ? result.data : { items: [], total: 0, page: pagination.page, pageSize: pagination.pageSize });
});

export const POST = withErrorHandling("/api/companies/[companyId]/purchase-requests", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-requests'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewPurchaseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await createPurchaseRequest({ ...parsed.data, companyId, requesterUserId: access.auth.userId });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
