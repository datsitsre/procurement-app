import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext } from '@/server/auth/context';
import { buildSessionPayload } from '@/server/dto/session';
import { withErrorHandling } from '@/server/errors';

/** Returns the current session, if any - used on app load to restore state after a page
 *  refresh. 200 with `null` (not 401) when there is no session: "not logged in" is an expected,
 *  routine state for this endpoint, not an error. */
export const GET = withErrorHandling("/api/auth/session", async (request: NextRequest) => {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json(null);

  const payload = await buildSessionPayload(auth.userId, auth.activeCompanyId ?? undefined);
  return NextResponse.json(payload);
});
