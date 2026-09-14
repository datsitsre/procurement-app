import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { resolveDispute } from '@/server/services/disputes.service';
import { ResolveDisputeSchema } from '@/server/validation/orders';

/** A platform admin closes out a dispute - RESOLVED_REFUND also marks the underlying order's
 *  payment REFUNDED. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/disputes/[id]/resolve'>) {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = ResolveDisputeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const { id } = await ctx.params;
  const result = await resolveDispute(id, parsed.data.decision, parsed.data.note, access.auth.userId, access.auth.userName);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
