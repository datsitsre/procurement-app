import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db';
import { verifyPassword } from '@/server/auth/password';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { checkRateLimit, recordAttempt, clearAttempts, getRetryAfterSeconds } from '@/server/auth/rate-limit';
import { isSameOrigin } from '@/server/auth/csrf';
import { buildSessionPayload } from '@/server/dto/session';
import { logger } from '@/server/observability/logger';
import { LoginSchema } from '@/server/validation/auth';
import { withErrorHandling } from '@/server/errors';

/** A single, generic message for every kind of login failure - never distinguish "no such
 *  email" from "wrong password" in the response, so an attacker can't enumerate which emails
 *  are registered (section 7/21's safe-error-handling rule applied to auth specifically). */
const INVALID_CREDENTIALS = { error: 'That email or password is incorrect.' };

/** High-risk domain (section 12) - logs the outcome of every attempt with status/duration/
 *  errorCode, but deliberately never the email or password themselves (only `userId` once one is
 *  known, never the credential that resolved it). */
export const POST = withErrorHandling("/api/auth/login", async (request: NextRequest) => {
  const startedAt = Date.now();
  const requestId = request.headers.get('x-request-id') ?? undefined;
  const route = '/api/auth/login';
  function complete(status: number, errorCode?: string, userId?: string) {
    logger.info('login attempt completed', { requestId, route, method: 'POST', status, errorCode, userId, durationMs: Date.now() - startedAt });
  }

  if (!isSameOrigin(request)) {
    complete(403, 'INVALID_ORIGIN');
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    complete(422, 'INVALID_REQUEST');
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const { email, password } = parsed.data;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const rateLimitKey = `${ip}:${email.toLowerCase()}`;
  if (!checkRateLimit('auth', rateLimitKey)) {
    complete(429, 'RATE_LIMITED');
    const response = NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    response.headers.set('Retry-After', String(getRetryAfterSeconds('auth', rateLimitKey)));
    return response;
  }

  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    recordAttempt('auth', rateLimitKey);
    complete(401, 'INVALID_CREDENTIALS');
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }
  clearAttempts('auth', rateLimitKey);

  const payload = await buildSessionPayload(user.id);
  if (!payload) {
    complete(401, 'NO_SESSION_PAYLOAD', user.id);
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const { token, expiresAt } = await createSession({
    userId: user.id,
    activeCompanyId: payload.activeCompanyId ?? undefined,
    userAgent: request.headers.get('user-agent'),
    ipAddress: ip,
  });

  // `buildSessionPayload` only ever includes ACTIVE memberships in `companies` - a correctly
  // authenticated login with zero active memberships (PENDING_APPROVAL, REJECTED, SUSPENDED)
  // still succeeds (this is not a credential failure), but the client has no way to explain
  // *why* there's nothing to sign into without this. Only the caller's own, already-verified
  // account's status is ever revealed here - never another user's, never which company.
  const responseBody: typeof payload & { membershipStatus?: string | null } = payload;
  if (payload.companies.length === 0) {
    const mostRecentMembership = await db.companyMembership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    responseBody.membershipStatus = mostRecentMembership?.status ?? null;
  }

  const response = NextResponse.json(responseBody);
  setSessionCookie(response, token, expiresAt);
  complete(200, undefined, user.id);
  return response;
});
