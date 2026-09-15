import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/server/observability/logger';

/**
 * Request correlation (section 11) - every API request gets a request ID, generated here (before
 * any route handler runs) rather than in each of the 83 route files individually, so coverage is
 * automatic and can't be forgotten by a new route. Also the one natural place to log "a request
 * arrived" for every API call without threading a logging call through every handler.
 *
 * Renamed from `middleware.ts` to `proxy.ts` in Next.js 16 (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md) - same
 * mechanism, Node.js runtime by default, which is what makes the plain `crypto.randomUUID()` call
 * below safe to use (no edge-runtime restriction here).
 */

const REQUEST_ID_HEADER = 'x-request-id';
// Generous but bounded - long enough for a UUID or a typical upstream-load-balancer trace id,
// short enough that a malicious caller can't use this header to smuggle an oversized value
// through to logs/downstream headers.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Trusts an upstream-supplied request id only if it's a safe, bounded token - anything else
 *  (missing, malformed, oversized) gets a freshly generated one instead of ever passing an
 *  unvalidated client-controlled string into logs or response headers. */
function resolveRequestId(request: NextRequest): string {
  const supplied = request.headers.get(REQUEST_ID_HEADER);
  if (supplied && SAFE_REQUEST_ID.test(supplied)) return supplied;
  return crypto.randomUUID();
}

export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request);

  logger.info('request received', {
    requestId,
    route: request.nextUrl.pathname,
    method: request.method,
  });

  // Forwarded to the route handler (readable via request.headers.get('x-request-id')) so any
  // logging a route or service does can carry the same id without re-deriving it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Echoed back to the caller so a bug report ("my request failed") can be correlated to server
  // logs without exposing anything sensitive - it's an opaque, non-secret identifier.
  response.headers.set('X-Request-Id', requestId);
  return response;
}

export const config = {
  // Scoped to the API surface - the primary place this app's own consumers (its own frontend
  // today, a future integration partner eventually) need request correlation. Page
  // navigation/static assets don't need a log line per request the way API calls do.
  matcher: '/api/:path*',
};
