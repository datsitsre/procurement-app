// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/server/db';
import { createSession } from '@/server/auth/session';
import { PATCH as updateProfileRoute } from '@/app/api/users/me/route';

/**
 * Deployment-readiness follow-up: "edit the user account, add pictures" - regression suite at
 * the real API boundary. A user editing their own profile needs no company membership at all
 * (it's not a tenant-scoped action), so this scratch user deliberately has none - just a real
 * minted session, the same createSession function /api/auth/login calls.
 */

const TEST_USER_ID = `test-user-routes-profile-${Date.now()}`;
let sessionToken: string;

function requestFor(body: string, init?: { origin?: string | null }) {
  const headers = new Headers({ cookie: `session_token=${sessionToken}`, 'content-type': 'application/json' });
  if (init?.origin !== null) headers.set('origin', init?.origin ?? 'http://localhost');
  return new NextRequest('http://localhost/api/users/me', { method: 'PATCH', body, headers });
}

beforeAll(async () => {
  await db.user.create({ data: { id: TEST_USER_ID, name: 'Routes Profile Test User', email: `${TEST_USER_ID}@example.test`, passwordHash: 'x' } });
  sessionToken = (await createSession({ userId: TEST_USER_ID })).token;
});

afterAll(async () => {
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => undefined);
});

describe('PATCH /api/users/me', () => {
  it('rejects an unauthenticated request', async () => {
    const request = new NextRequest('http://localhost/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'X' }),
      headers: new Headers({ origin: 'http://localhost', 'content-type': 'application/json' }),
    });
    const response = await updateProfileRoute(request);
    expect(response.status).toBe(401);
  });

  it('rejects a mutation with no Origin header (CSRF guard)', async () => {
    const response = await updateProfileRoute(requestFor(JSON.stringify({ name: 'X' }), { origin: null }));
    expect(response.status).toBe(403);
  });

  it("updates the caller's own name and avatar, never trusting any id but the session's own", async () => {
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const response = await updateProfileRoute(requestFor(JSON.stringify({ name: 'Updated Via Route', avatarUrl: avatar })));
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.id).toBe(TEST_USER_ID);
    expect(updated.name).toBe('Updated Via Route');
    expect(updated.avatarUrl).toBe(avatar);

    const stored = await db.user.findUnique({ where: { id: TEST_USER_ID } });
    expect(stored?.name).toBe('Updated Via Route');
  });

  it('rejects an invalid request body', async () => {
    const response = await updateProfileRoute(requestFor(JSON.stringify({ name: '' })));
    expect(response.status).toBe(422);
  });
});
