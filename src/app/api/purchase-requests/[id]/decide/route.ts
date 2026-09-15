import { NextResponse, type NextRequest } from 'next/server';
import { Permission, hasPermission } from '@/config/rbac';
import { getAuthContext, unauthorized, forbidden } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { decideStep, getPurchaseRequest } from '@/server/services/procurement.service';
import { DecideStepSchema } from '@/server/validation/procurement';
import { ownsRecord } from '@/services/base';

/** Having PURCHASE_REQUEST_APPROVE and the right role for the pending step only proves this
 *  caller can approve *some* company's requests - ownership is re-checked against the fetched
 *  record, never a path segment, so a Finance Manager at any company can't approve or reject
 *  another company's purchase request outright. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/purchase-requests/[id]/decide'>) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();
  if (!auth.role || !hasPermission(auth.role, Permission.PURCHASE_REQUEST_APPROVE)) return forbidden();

  const { id } = await ctx.params;
  const pr = await getPurchaseRequest(id);
  if (!pr.ok || !ownsRecord(auth.tenant, pr.data.companyId)) {
    return NextResponse.json({ error: 'That purchase request could not be found.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = DecideStepSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await decideStep(id, auth.role, parsed.data.decision, auth.userId, auth.userName, parsed.data.comment);
  if (!result.ok) {
    const status = result.error.code === 'CONFLICT' ? 409 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
}
