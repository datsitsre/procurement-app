import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { getPurchaseRequest } from '@/server/services/procurement.service';
import { ownsRecord } from '@/services/base';
import { withErrorHandling } from '@/server/errors';

/** A purchase request's owner (its companyId) isn't known until it's fetched, so - like the
 *  product PATCH route - ownership is checked against the fetched record, not a path segment. */
export const GET = withErrorHandling("/api/purchase-requests/[id]", async (request: NextRequest, ctx: RouteContext<'/api/purchase-requests/[id]'>) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  const result = await getPurchaseRequest(id);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  if (!ownsRecord(auth.tenant, result.data.companyId)) {
    return NextResponse.json({ error: 'That purchase request could not be found.' }, { status: 404 });
  }

  return NextResponse.json(result.data);
});
