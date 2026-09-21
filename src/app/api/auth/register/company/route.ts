import { NextResponse, type NextRequest } from 'next/server';
import { hashPassword } from '@/server/auth/password';
import { isSameOrigin } from '@/server/auth/csrf';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { RegisterCompanySchema } from '@/server/validation/auth';
import { registerCompanyPublicly } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/**
 * PUBLIC COMPANY REGISTRATION PAGE phase - reached from /register/company, itself reached from
 * the login page's own "Create an account" link. Distinct from:
 *   - POST /api/auth/register - the plain company-name/country/currency flow, still reachable
 *     from the marketing landing page's own "Get started" buttons; left completely unmodified.
 *   - POST /api/admin/companies - the Super Admin's own Add Company wizard, which requires an
 *     authenticated PLATFORM_COMPANIES_CREATE session and never issues one here.
 *
 * Reuses the exact same PENDING_APPROVAL lifecycle POST /api/auth/register already established
 * (see registerCompanyPublicly's own comment) - a publicly registered company's OWNER/ADMIN
 * membership starts locked out, and only a platform admin's decideRegistration call
 * (platformUsers.service.ts, unchanged) can activate it. No new approval mechanism, no
 * Company-level status field, nothing invented here.
 *
 * Deliberately issues no session for a brand-new account - this page's confirmation state needs
 * nothing but this response's own body.
 *
 * SECURITY HARDENING phase - an `administrator.email` that already belongs to an existing User
 * is rejected outright (registerCompanyPublicly's ACCOUNT_EXISTS), not silently reused. The
 * response is deliberately generic: it confirms only that an account exists for that email and
 * points at the existing /login - never passwordHash, never role, never any other company this
 * account belongs to, never whether that account is active/suspended. This is a real, if narrow,
 * information disclosure (confirming an email is registered at all) that the phase's own
 * instructions explicitly accept as necessary to show the required "sign in to continue" UI - the
 * alternative (silently creating a pending membership against someone else's account without
 * proof of ownership) was the actual vulnerability being fixed here, and is strictly worse.
 * `hashPassword` still runs before this check either way, so a request against an existing email
 * takes roughly the same time as one that goes on to create a new account - not a perfect
 * mitigation, but it avoids obviously answering "does this email exist" via response latency.
 */
export const POST = withErrorHandling('/api/auth/register/company', async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('auth', `register-company:${ip}`);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = RegisterCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const { administrator, ...companyFields } = parsed.data;
  const passwordHash = await hashPassword(administrator.password);

  const result = await registerCompanyPublicly({
    ...companyFields,
    administrator: { name: administrator.name, email: administrator.email, phone: administrator.phone || undefined, role: administrator.role, passwordHash },
  });

  if (!result.ok) {
    const status = result.error.code === 'ACCOUNT_EXISTS' || result.error.code === 'DUPLICATE_REGISTRATION_NUMBER' ? 409 : 422;
    return NextResponse.json({ error: result.error.message, code: result.error.code }, { status });
  }

  return NextResponse.json({
    company: { name: result.data.companyName, registeredEmail: result.data.registeredEmail },
    registrationStatus: result.data.registrationStatus,
    message: 'Your company registration has been submitted and is now pending review. You will be able to sign in once a platform administrator approves it.',
  });
});
