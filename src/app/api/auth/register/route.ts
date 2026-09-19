import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db';
import { hashPassword } from '@/server/auth/password';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { isSameOrigin } from '@/server/auth/csrf';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { RegisterSchema } from '@/server/validation/auth';
import { withErrorHandling } from '@/server/errors';

/**
 * Registers a new buyer company and its first user, who becomes OWNER of it - mirrors
 * auth.service.ts's mock `register`. Company + User + CompanyMembership are created in one
 * transaction (section 12) so a failure partway through (e.g. the membership insert) can never
 * leave an orphaned company or user behind with no way to sign in to it.
 *
 * Phase 26 - the new membership starts `PENDING_APPROVAL`, not `ACTIVE`. This is not a new
 * enforcement mechanism: `resolveTenant` (server/auth/context.ts) and `buildSessionPayload`
 * (server/dto/session.ts) already treat any non-ACTIVE membership as "no tenant, no role, no
 * company in the session payload" - a real, pre-existing fail-closed behavior originally built
 * for INVITED/SUSPENDED. Setting the *initial* status to PENDING_APPROVAL instead of ACTIVE
 * means a brand-new self-registration is automatically covered by that same, already-verified
 * gate - the elevated access (OWNER of a real company) genuinely cannot be exercised until a
 * platform admin approves it (`server/services/platformUsers.service.ts`'s `decideRegistration`).
 * A session is still issued (the client needs one to show a "pending approval" screen and to log
 * out), but it carries no working tenant/role until that happens - verified by
 * registration.routes.test.ts's "PENDING_APPROVAL cannot access protected functionality" tests.
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
      data: { companyId: company.id, userId: user.id, role: 'OWNER', status: 'PENDING_APPROVAL' },
    });
    return { user, membership };
  });

  // Deliberately NOT buildSessionPayload's own shape here (it strips non-ACTIVE memberships
  // entirely, which is correct for login/session but would silently hide *why* this response has
  // no companies - a fresh registrant needs to be told they're pending, not just given an empty
  // list that looks like a bug).
  const response = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt.toISOString() },
    registrationStatus: 'PENDING_APPROVAL',
    message: 'Your account has been created and is awaiting approval. You will be able to sign in once a platform administrator approves your registration.',
  });

  const { token, expiresAt } = await createSession({
    userId: user.id,
    activeCompanyId: membership.companyId,
    userAgent: request.headers.get('user-agent'),
    ipAddress: request.headers.get('x-forwarded-for'),
  });
  setSessionCookie(response, token, expiresAt);
  return response;
});
