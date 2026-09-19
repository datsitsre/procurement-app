import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/server/observability/logger';

/**
 * Request correlation (section 11, Phase 14) + per-request CSP nonce (Phase 17, section 4).
 *
 * Renamed from `middleware.ts` to `proxy.ts` in Next.js 16 (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md) - same
 * mechanism, Node.js runtime by default, which is what makes the plain `crypto.randomUUID()` call
 * below safe to use (no edge-runtime restriction here).
 *
 * Two independent concerns live in one file because Next.js supports only one proxy per app:
 *  - API requests (`/api/*`): tagged with a request id, as before Phase 17. No CSP - a JSON
 *    response has no scripts/styles for a CSP to govern.
 *  - Page requests (everything else, matching Next's own documented CSP matcher pattern -
 *    excluding _next/static, _next/image, favicon.ico, and prefetch requests): get a fresh
 *    nonce every request, threaded through both the `Content-Security-Policy` response header
 *    and an `x-nonce` request header the root layout reads via `headers()` (see
 *    src/app/layout.tsx) - forcing every page into dynamic rendering, since a nonce baked into a
 *    build-time-static HTML shell would be reused across every visitor and defeat its own
 *    purpose. See PHASE17_AUDIT.md finding 2 for the full trade-off this implies (every
 *    previously-static page becomes server-rendered per request) and PHASE17_FINAL_REPORT.md's
 *    CSP section for the live-verified outcome.
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

function apiProxy(request: NextRequest): NextResponse {
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

/** Enforced by default (Phase 17) - the nonce plumbing below has been live-verified end to end
 *  across every workspace (buyer/supplier/platform-admin) and every major page with zero CSP
 *  violations in both Report-Only and enforced mode; see PHASE17_FINAL_REPORT.md's CSP section
 *  for the full evidence. Set `CSP_ENFORCED=false` as an emergency rollback to Report-Only
 *  without a redeploy, if real production traffic surfaces an inline script this session's
 *  manual verification didn't happen to exercise. Kept as a single flag rather than two
 *  near-duplicate code paths so Report-Only and enforced modes can never drift apart in the set
 *  of directives they apply - only whether violations are reported or actually blocked. */
const CSP_ENFORCED = process.env.CSP_ENFORCED !== 'false';

function pageProxy(request: NextRequest): NextResponse {
  // Matches Next's own documented nonce pattern exactly (content-security-policy.md, "Adding a
  // nonce with Proxy") - a fresh, unguessable value every request.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const cspHeader = [
    "default-src 'self'",
    // 'strict-dynamic' lets a nonce'd script load further scripts (Next's own chunk-loading
    // behavior) without needing to nonce every single one individually; 'self' remains as a
    // fallback for browsers that don't support strict-dynamic. No 'unsafe-inline' - an inline
    // script without the matching nonce is blocked (enforced mode) or reported (Report-Only).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Inline style PROPS (style={{...}}) render as a DOM `style=""` attribute, not a `<style>`
    // element - a nonce only applies to `<style>`/`<script>` tags, never to the style attribute,
    // so 'unsafe-inline' remains genuinely necessary here (not a leftover default) for as long
    // as this app uses inline style props anywhere - confirmed unchanged since Phase 16's audit.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'report-uri /api/csp-report',
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_ENFORCED ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', cspHeader);
  return response;
}

export function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith('/api') ? apiProxy(request) : pageProxy(request);
}

export const config = {
  matcher: [
    '/api/:path*',
    // Next's own documented negative-match pattern for CSP-relevant page requests - excludes
    // static assets/prefetches, which don't need a fresh per-request nonce.
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
