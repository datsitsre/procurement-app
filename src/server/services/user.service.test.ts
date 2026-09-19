// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { updateUserProfile } from './user.service';

/**
 * Deployment-readiness follow-up: "edit the user account, add pictures" - real, database-backed
 * regression suite. Runs against the actual dev Postgres database, scoped to a dedicated scratch
 * user this suite creates and cleans up in `afterAll` - never touches seeded demo data.
 */

const TEST_USER_ID = `test-user-profile-${Date.now()}`;
// A minimal, obviously-fake 1x1 PNG data URI - real enough to exercise the "starts with
// data:image/" validation without needing an actual image file in this test.
const FAKE_AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

beforeAll(async () => {
  await db.user.create({ data: { id: TEST_USER_ID, name: 'Profile Test User', email: `${TEST_USER_ID}@example.test`, passwordHash: 'x' } });
});

afterAll(async () => {
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => undefined);
});

describe('updateUserProfile', () => {
  it('updates name, phone, and avatar together', async () => {
    const result = await updateUserProfile(TEST_USER_ID, { name: 'New Name', phone: '0244000000', avatarUrl: FAKE_AVATAR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('New Name');
    expect(result.data.phone).toBe('0244000000');
    expect(result.data.avatarUrl).toBe(FAKE_AVATAR);
  });

  it('rejects an empty name', async () => {
    const result = await updateUserProfile(TEST_USER_ID, { name: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_NAME');
  });

  it('rejects a value that is not an image data URI', async () => {
    const result = await updateUserProfile(TEST_USER_ID, { avatarUrl: 'not-an-image' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_AVATAR');
  });

  it('rejects an oversized avatar', async () => {
    const huge = 'data:image/png;base64,' + 'a'.repeat(600_000);
    const result = await updateUserProfile(TEST_USER_ID, { avatarUrl: huge });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AVATAR_TOO_LARGE');
  });

  it('clears the avatar with an empty string, leaving name/phone untouched when omitted', async () => {
    const cleared = await updateUserProfile(TEST_USER_ID, { avatarUrl: '' });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.data.avatarUrl).toBeUndefined();
      expect(cleared.data.name).toBe('New Name');
      expect(cleared.data.phone).toBe('0244000000');
    }
  });

  it('leaves phone alone when omitted, but clears it with an explicit empty string', async () => {
    const untouched = await updateUserProfile(TEST_USER_ID, { name: 'Still New Name' });
    expect(untouched.ok).toBe(true);
    if (untouched.ok) expect(untouched.data.phone).toBe('0244000000');

    const cleared = await updateUserProfile(TEST_USER_ID, { phone: '' });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.data.phone).toBeUndefined();
  });
});
