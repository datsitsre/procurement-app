import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db';
import { verifyPassword } from '@/server/auth/password';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { checkRateLimit, recordAttempt, clearAttempts } from '@/server/auth/rate-limit';
import { isSameOrigin } from '@/server/auth/csrf';
import { buildSessionPayload } from '@/server/dto/session';
import { LoginSchema } from '@/server/validation/auth';

/** A single, generic message for every kind of login failure - never distinguish "no such
 *  email" from "wrong password" in the response, so an attacker can't enumerate which emails
 *  are registered (section 7/21's safe-error-handling rule applied to auth specifically). */
const INVALID_CREDENTIALS = { error: 'That email or password is incorrect.' };

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const { email, password } = parsed.data;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const rateLimitKey = `${ip}:${email.toLowerCase()}`;
  if (!checkRateLimit('auth', rateLimitKey)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    recordAttempt('auth', rateLimitKey);
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }
  clearAttempts('auth', rateLimitKey);

  const payload = await buildSessionPayload(user.id);
  if (!payload) return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });

  const { token, expiresAt } = await createSession({
    userId: user.id,
    activeCompanyId: payload.activeCompanyId ?? undefined,
    userAgent: request.headers.get('user-agent'),
    ipAddress: ip,
  });

  const response = NextResponse.json(payload);
  setSessionCookie(response, token, expiresAt);
  return response;
}
