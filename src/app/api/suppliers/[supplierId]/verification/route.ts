import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { verifySupplier } from '@/server/services/catalog.service';
import { VerifySupplierSchema } from '@/server/validation/catalog';

/** Verifies, suspends, or rejects a supplier - platform-admin only (section 46), same shape as
 *  PATCH /api/products/[productId]/moderation. Not requireSupplierAccess - a supplier can't
 *  verify itself, this is exclusively a platform decision. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/verification'>) {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = VerifySupplierSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const { supplierId } = await ctx.params;
  const result = await verifySupplier(supplierId, parsed.data.decision, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
}
