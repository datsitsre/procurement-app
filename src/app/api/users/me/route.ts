import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticated } from '@/server/auth/require';
import { updateUserProfile } from '@/server/services/user.service';
import { UpdateUserProfileSchema } from '@/server/validation/user';

/** Editing your own account - name, phone, avatar. No permission required beyond being signed
 *  in (requireAuthenticated with no Permission argument) - this isn't a company-scoped action,
 *  and `access.auth.userId` (never a client-supplied id) is the only identity that matters here. */
export async function PATCH(request: NextRequest) {
  const access = await requireAuthenticated(request);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = UpdateUserProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await updateUserProfile(access.auth.userId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
