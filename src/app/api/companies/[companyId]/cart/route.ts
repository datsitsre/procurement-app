import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { clear, getCart } from '@/server/services/cart.service';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/cart", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/cart'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await getCart(companyId);
  return NextResponse.json(result.ok ? result.data : { id: `cart-${companyId}`, companyId, items: [] });
});

export const DELETE = withErrorHandling("/api/companies/[companyId]/cart", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/cart'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await clear(companyId);
  return NextResponse.json(result.ok ? result.data : { id: `cart-${companyId}`, companyId, items: [] });
});
