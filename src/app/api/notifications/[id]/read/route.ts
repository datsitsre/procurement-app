import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { isSameOrigin } from '@/server/auth/csrf';
import { markRead } from '@/server/services/notification.service';
import { withErrorHandling } from '@/server/errors';

export const POST = withErrorHandling("/api/notifications/[id]/read", async (request: NextRequest, ctx: RouteContext<'/api/notifications/[id]/read'>) => {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const { id } = await ctx.params;
  await markRead(id, auth.userId);
  return NextResponse.json({ ok: true });
});
