import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * Lightweight CSRF defense for cookie-authenticated mutations (section 7/21). SameSite=Lax on
 * the session cookie already blocks the classic cross-site form-POST attack; this is a second,
 * independent check - the request's Origin (or Referer, as a fallback for older/stricter
 * clients that omit Origin) must match this app's own origin. A cross-origin page can trigger a
 * request to us, but it cannot forge our own Origin header, so this rejects it before any
 * mutation runs. Read-only GET requests don't need this - only state-changing methods do.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}
