import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { moderateProduct } from '@/server/services/catalog.service';
import { ModerateProductSchema } from '@/server/validation/catalog';

/** Publishes or rejects a product awaiting moderation - a rejected listing stays visible to
 *  its supplier (with a moderationNote explaining why) but never reaches the buyer catalog. */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/products/[productId]/moderation'>) {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = ModerateProductSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const { productId } = await ctx.params;
  const result = await moderateProduct(productId, parsed.data.decision, parsed.data.note, {
    id: access.auth.userId,
    name: access.auth.userName,
  });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
}
