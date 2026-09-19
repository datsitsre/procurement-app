import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { requireAuthenticated } from '@/server/auth/require';
import { isSameOrigin } from '@/server/auth/csrf';
import { getOrder } from '@/server/services/orders.service';
import { createDispute, listAllDisputes } from '@/server/services/disputes.service';
import { NewDisputeSchema } from '@/server/validation/orders';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

/** Every dispute across every company - the admin dispute queue (section 46/49). */
export const GET = withErrorHandling("/api/disputes", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const result = await listAllDisputes();
  return NextResponse.json(result.ok ? result.data : []);
});

/** A buyer reports an issue with one of their own orders. `companyId`/`supplierId` are derived
 *  from the real order record, never trusted from the caller directly - otherwise a buyer could
 *  fabricate a dispute against an order that isn't theirs (section 9.2). */
export const POST = withErrorHandling("/api/disputes", async (request: NextRequest) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = NewDisputeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const order = await getOrder(parsed.data.orderId);
  if (!order.ok || !ownsRecord(auth.tenant, order.data.companyId)) {
    return NextResponse.json({ error: 'That order could not be found.' }, { status: 404 });
  }

  const result = await createDispute({
    orderId: order.data.id,
    companyId: order.data.companyId,
    supplierId: order.data.supplierId,
    reason: parsed.data.reason,
    description: parsed.data.description,
  });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
