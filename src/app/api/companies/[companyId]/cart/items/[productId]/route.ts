import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { removeItem, setQuantity } from '@/server/services/cart.service';
import { SetCartQuantitySchema } from '@/server/validation/cart';

export async function PUT(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/cart/items/[productId]'>) {
  const { companyId, productId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = SetCartQuantitySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await setQuantity(companyId, productId, parsed.data.quantity);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/cart/items/[productId]'>) {
  const { companyId, productId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await removeItem(companyId, productId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
