import { NextResponse, type NextRequest } from 'next/server';
import { Permission, hasPermission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { getOrder, markDelivered } from '@/server/services/orders.service';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

export const POST = withErrorHandling("/api/orders/[id]/delivered", async (request: NextRequest, ctx: RouteContext<'/api/orders/[id]/delivered'>) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();
  if (!auth.role || !hasPermission(auth.role, Permission.ORDERS_FULFILL)) return forbidden();

  const { id } = await ctx.params;
  const order = await getOrder(id);
  if (!order.ok || !ownsRecord(auth.tenant, undefined, order.data.supplierId)) {
    return NextResponse.json({ error: 'That order could not be found.' }, { status: 404 });
  }

  const result = await markDelivered(id);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
