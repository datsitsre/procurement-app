import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { markAllRead } from '@/server/services/notification.service';
import { withErrorHandling } from '@/server/errors';

export const POST = withErrorHandling("/api/notifications/read-all", async (request: NextRequest) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  await markAllRead(auth.userId);
  return NextResponse.json({ ok: true });
});
