import { NextResponse, type NextRequest } from 'next/server';
import { isSameOrigin } from '@/server/auth/csrf';
import { acceptInvitation } from '@/server/services/invitation.service';
import { AcceptInvitationSchema } from '@/server/validation/auth';
import { withErrorHandling } from '@/server/errors';

/** Accepts an invitation (Part 7/14) - public/unauthenticated by necessity, the same as login,
 *  register, and the password-reset completion endpoint, since the person hasn't signed in yet
 *  (or, for an existing account, doesn't need to - the token itself is the credential proving
 *  they hold this specific invitation, same trust model as password reset). See
 *  invitation.service.ts's acceptInvitation for the full transactional flow. */
export const POST = withErrorHandling("/api/invitations/accept", async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = AcceptInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await acceptInvitation(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: 422 });
  return NextResponse.json(result.data);
});
