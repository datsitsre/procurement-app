import { NextResponse, type NextRequest } from 'next/server';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { logger } from '@/server/observability/logger';
import { withErrorHandling } from '@/server/errors';

/**
 * Collector for the Report-Only CSP header set in next.config.ts (Phase 16, section 11). Not
 * session/cookie-authenticated - the browser sends these itself, same as a webhook, so this
 * reuses the 'webhook' rate-limit kind to bound spam without needing a new one. Every report is
 * logged (never enforced - Report-Only can't block anything) as real evidence for scoping a
 * future nonce-based blocking CSP, rather than guessing what's inline.
 */
export const POST = withErrorHandling("/api/csp-report", async (request: NextRequest) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('webhook', `csp-report:${ip}`);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (body) logger.warn('CSP report-only violation', { report: body });

  return new NextResponse(null, { status: 204 });
});
