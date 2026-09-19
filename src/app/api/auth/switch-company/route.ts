import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db';
import { getAuthContext, unauthorized } from '@/server/auth/context';
import { setActiveCompany } from '@/server/auth/session';
import { isSameOrigin } from '@/server/auth/csrf';
import { buildSessionPayload } from '@/server/dto/session';
import { SwitchCompanySchema } from '@/server/validation/auth';
import { withErrorHandling } from '@/server/errors';

export const POST = withErrorHandling("/api/auth/switch-company", async (request: NextRequest) => {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  const auth = await getAuthContext(request);
  if (!auth) return unauthorized();

  const body = await request.json().catch(() => null);
  const parsed = SwitchCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });
  }

  // Never trust that the caller actually belongs to the requested company just because they
  // asked for it - the same tenant-isolation principle as every other mutation in this app.
  const membership = await db.companyMembership.findUnique({
    where: { companyId_userId: { companyId: parsed.data.companyId, userId: auth.userId } },
  });
  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'You are not a member of that company.' }, { status: 403 });
  }

  await setActiveCompany(auth.sessionId, parsed.data.companyId);

  const payload = await buildSessionPayload(auth.userId, parsed.data.companyId);
  return NextResponse.json(payload);
});
