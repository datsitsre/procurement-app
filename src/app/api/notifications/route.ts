import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { list } from '@/server/services/notification.service';

/** A user's own notifications - always scoped to the caller's session id, never a query param
 *  or path segment, since there's no legitimate reason to read anyone else's. */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const result = await list(auth.userId);
  return NextResponse.json(result.ok ? result.data : []);
}
