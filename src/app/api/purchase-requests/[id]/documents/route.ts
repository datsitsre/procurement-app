import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { uploadPurchaseRequestDocument } from '@/server/services/documents.service';
import { withErrorHandling } from '@/server/errors';

/** Upload an attachment to a purchase request (section 18). Ownership is the requesting buyer
 *  company only - unlike an RFQ, a purchase request has no supplier-side party until it becomes
 *  one, matching `GET /api/purchase-requests/[id]`'s own ownership check. */
export const POST = withErrorHandling("/api/purchase-requests/[id]/documents", async (request: NextRequest, ctx: RouteContext<'/api/purchase-requests/[id]/documents'>) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const limited = enforceRateLimit('procurementWrite', auth.userId);
  if (limited) return limited;

  const { id } = await ctx.params;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'A file is required.' }, { status: 422 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const result = await uploadPurchaseRequestDocument(id, auth.tenant, auth.userId, {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    data,
  });

  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }

  return NextResponse.json(result.data, { status: 201 });
});
