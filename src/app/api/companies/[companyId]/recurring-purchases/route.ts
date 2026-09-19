import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { createRecurringPurchase, listRecurringPurchases } from '@/server/services/recurringPurchase.service';
import { NewRecurringPurchaseSchema } from '@/server/validation/procurement-backend';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/recurring-purchases", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/recurring-purchases'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listRecurringPurchases(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});

export const POST = withErrorHandling("/api/companies/[companyId]/recurring-purchases", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/recurring-purchases'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('procurementWrite', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = NewRecurringPurchaseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });

  const result = await createRecurringPurchase({ companyId, requesterUserId: access.auth.userId, ...parsed.data });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
