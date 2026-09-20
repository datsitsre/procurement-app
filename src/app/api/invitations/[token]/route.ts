import { NextResponse, type NextRequest } from 'next/server';
import { getInvitationPreview } from '@/server/services/invitation.service';
import { withErrorHandling } from '@/server/errors';

/** A safe, pre-authentication preview for the public /accept-invitation page - public by
 *  necessity (the person hasn't signed in yet), identified purely by token possession, the same
 *  trust model GET .../reset-password's completion endpoint already uses. Never returns
 *  anything beyond what's needed to render "Join <company> as <role>" - no other company's data,
 *  no account-existence signal beyond this exact invitation's own email. */
export const GET = withErrorHandling("/api/invitations/[token]", async (_request: NextRequest, ctx: RouteContext<'/api/invitations/[token]'>) => {
  const { token } = await ctx.params;
  const result = await getInvitationPreview(token);
  if (!result.ok) return NextResponse.json({ error: result.error.message, code: result.error.code }, { status: 404 });
  return NextResponse.json(result.data);
});
