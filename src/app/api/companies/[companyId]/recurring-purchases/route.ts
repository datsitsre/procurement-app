import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { createRecurringPurchase, listRecurringPurchases } from '@/server/services/recurringPurchase.service';
import { NewRecurringPurchaseSchema } from '@/server/validation/procurement-backend';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/recurring-purchases'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listRecurringPurchases(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/recurring-purchases'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewRecurringPurchaseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });

  const result = await createRecurringPurchase({ companyId, requesterUserId: access.auth.userId, ...parsed.data });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
