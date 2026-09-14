import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { createPurchaseRequest, listPurchaseRequests } from '@/server/services/procurement.service';
import { NewPurchaseRequestSchema } from '@/server/validation/procurement';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-requests'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listPurchaseRequests(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-requests'>) {
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
}
