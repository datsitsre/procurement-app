import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { deleteDocument, getDocumentForDownload } from '@/server/services/documents.service';
import { withErrorHandling } from '@/server/errors';

/** Download a document's bytes (section 11 - "authorized tenant -> allowed, unauthorized ->
 *  denied, unauthenticated -> denied, nonexistent -> 404"). Streams the file back directly rather
 *  than a signed URL redirect - this app's storage backend is local disk (see
 *  server/services/storage), which has no concept of a signed URL; nothing here exposes a
 *  storage-provider credential or path, only the already-authorized bytes. */
export const GET = withErrorHandling("/api/documents/[documentId]", async (request: NextRequest, ctx: RouteContext<'/api/documents/[documentId]'>) => {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { documentId } = await ctx.params;
  const result = await getDocumentForDownload(documentId, auth.tenant);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });

  const { fileName, mimeType, data } = result.data;
  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      // encodeURIComponent, not the raw name, in case sanitizeFileName ever changes to allow a
      // wider character set - a header value can't safely contain arbitrary bytes.
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});

export const DELETE = withErrorHandling("/api/documents/[documentId]", async (request: NextRequest, ctx: RouteContext<'/api/documents/[documentId]'>) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { documentId } = await ctx.params;
  const result = await deleteDocument(documentId, auth.tenant);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });

  return NextResponse.json({ ok: true });
});
