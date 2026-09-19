import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db';
import { hashPassword } from '@/server/auth/password';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { isSameOrigin } from '@/server/auth/csrf';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { buildSessionPayload } from '@/server/dto/session';
import { RegisterSchema } from '@/server/validation/auth';
import { withErrorHandling } from '@/server/errors';

/**
 * Registers a new buyer company and its first user, who becomes OWNER of it - mirrors
 * auth.service.ts's mock `register`. Company + User + CompanyMembership are created in one
 * transaction (section 12) so a failure partway through (e.g. the membership insert) can never
 * leave an orphaned company or user behind with no way to sign in to it.
 */
export const POST = withErrorHandling("/api/auth/register", async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('auth', `register:${ip}`);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const { companyName, country, currency, fullName, email, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return NextResponse.json(
      { error: 'Invalid request.', fieldErrors: { email: 'An account with this email already exists.' } },
      { status: 422 },
    );
  }

  const passwordHash = await hashPassword(password);

  const { user, membership } = await db.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name: companyName, country, currency, creditTerms: 'NET_30', isBuyer: true, isSupplier: false },
    });
    const user = await tx.user.create({
      data: { name: fullName, email: email.toLowerCase(), passwordHash },
    });
    const membership = await tx.companyMembership.create({
      data: { companyId: company.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
    });
    return { user, membership };
  });

  const payload = await buildSessionPayload(user.id, membership.companyId);
  if (!payload) return NextResponse.json({ error: 'Registration failed.' }, { status: 500 });

  const { token, expiresAt } = await createSession({
    userId: user.id,
    activeCompanyId: membership.companyId,
    userAgent: request.headers.get('user-agent'),
    ipAddress: request.headers.get('x-forwarded-for'),
  });

  const response = NextResponse.json(payload);
  setSessionCookie(response, token, expiresAt);
  return response;
});
