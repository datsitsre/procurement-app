import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * Lightweight CSRF defense for cookie-authenticated mutations (section 7/21). SameSite=Lax on
 * the session cookie already blocks the classic cross-site form-POST attack; this is a second,
 * independent check - the request's Origin (or Referer, as a fallback for older/stricter
 * clients that omit Origin) must match the host this request actually arrived on. A cross-origin
 * page can trigger a request to us, but it cannot forge either our real Host header or its own
 * browser-set Origin header, so this rejects it before any mutation runs. Read-only GET requests
 * don't need this - only state-changing methods do.
 *
 * Deliberately compares against the request's own `Host` header, not `request.nextUrl.origin` -
 * the latter reflects Next.js's own bound hostname/port (e.g. `0.0.0.0` under the standalone
 * server, or a hardcoded `localhost` under `next start`), not the domain a real client actually
 * connected to. Behind a real deployment (a real domain, optionally behind a reverse proxy),
 * `nextUrl.origin` would never equal a legitimate browser's Origin header, and this check would
 * reject every authenticated mutation - confirmed live against both `node
 * .next/standalone/server.js` and `next start`. The Host header, by contrast, is exactly what
 * the server actually bound the connection under and can't be forged by a browser making a
 * cross-origin request (only the attacker's own page's Origin is sent, never a spoofed Host).
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) return false;
  // A real HTTP request always carries a Host header (mandatory since HTTP/1.1) - this falls
  // back to `nextUrl.host` only for the rare synthetic request that omits one entirely (e.g. a
  // hand-built NextRequest in a test), never in production.
  const host = request.headers.get('host') ?? request.nextUrl.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
