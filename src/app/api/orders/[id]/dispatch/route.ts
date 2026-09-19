import { NextResponse, type NextRequest } from 'next/server';
import { Permission, hasPermission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { dispatchOrder, getOrder } from '@/server/services/orders.service';
import { DispatchOrderSchema } from '@/server/validation/orders';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

export const POST = withErrorHandling("/api/orders/[id]/dispatch", async (request: NextRequest, ctx: RouteContext<'/api/orders/[id]/dispatch'>) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();
  if (!auth.role || !hasPermission(auth.role, Permission.ORDERS_FULFILL)) return forbidden();

  const { id } = await ctx.params;
  const order = await getOrder(id);
  if (!order.ok || !ownsRecord(auth.tenant, undefined, order.data.supplierId)) {
    return NextResponse.json({ error: 'That order could not be found.' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = DispatchOrderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await dispatchOrder(id, parsed.data.driverName ?? '');
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
