import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { uploadRfqDocument } from '@/server/services/documents.service';
import { withErrorHandling } from '@/server/errors';

/** Upload an attachment to an RFQ (spec sheet, certificate, scanned document - section 18). Like
 *  `GET /api/rfqs/[rfqId]`, ownership (buyer company that created it, or an invited supplier)
 *  isn't known from the path alone - `uploadRfqDocument` fetches the RFQ and checks both. */
export const POST = withErrorHandling("/api/rfqs/[rfqId]/documents", async (request: NextRequest, ctx: RouteContext<'/api/rfqs/[rfqId]/documents'>) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const limited = enforceRateLimit('procurementWrite', auth.userId);
  if (limited) return limited;

  const { rfqId } = await ctx.params;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'A file is required.' }, { status: 422 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const result = await uploadRfqDocument(rfqId, auth.tenant, auth.userId, {
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
