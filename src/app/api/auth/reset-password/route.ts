import { NextResponse, type NextRequest } from 'next/server';
import { isSameOrigin } from '@/server/auth/csrf';
import { completePasswordReset } from '@/server/services/passwordReset.service';
import { CompletePasswordResetSchema } from '@/server/validation/auth';
import { withErrorHandling } from '@/server/errors';

/** Completes a password reset (Part B6) - public/unauthenticated by necessity, the same as login
 *  and register, since the person hasn't signed in yet. The token itself (not a session cookie)
 *  is the credential proving who this is; see passwordReset.service.ts for why a single generic
 *  failure covers "expired," "already used," and "never existed" alike. */
export const POST = withErrorHandling("/api/auth/reset-password", async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CompletePasswordResetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await completePasswordReset(parsed.data.token, parsed.data.newPassword);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json({ ok: true });
});
