import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, revokeSession, clearSessionCookie } from '@/server/auth/session';
import { isSameOrigin } from '@/server/auth/csrf';
import { withErrorHandling } from '@/server/errors';

export const POST = withErrorHandling("/api/auth/logout", async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) await revokeSession(token);

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
});
