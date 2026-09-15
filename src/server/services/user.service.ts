import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toUserDto } from '@/server/dto/company';
import type { ServiceResult, UUID } from '@/types/common';
import type { User } from '@/types/company';

/**
 * A user editing their own account - name, phone, and avatar. Deliberately not tenant/company-
 * scoped like everything else in this codebase: a User isn't owned by a company (a CompanyMembership
 * is), so the only ownership check that applies here is "is this the caller's own userId",
 * enforced by the route always passing the authenticated session's own id, never one from the
 * request body or URL.
 */

export interface UserProfilePatch {
  name?: string;
  phone?: string;
  /** A data: URI (this app has no file storage - see DEPLOYMENT.md's "what's intentionally not
   *  here yet" - so the image itself, resized/compressed client-side first, is what gets stored)
   *  or an empty string to remove the current avatar. `undefined` leaves it untouched. */
  avatarUrl?: string;
}

// Comfortably fits a compressed small avatar (the client resizes to at most 256x256 before
// this is ever called) while still refusing anything wildly oversized - not a real storage
// system's limit, just a sanity cap on how much of this table's own String column one row's
// avatar should be allowed to consume.
const MAX_AVATAR_DATA_URL_LENGTH = 500_000;

export async function updateUserProfile(userId: UUID, patch: UserProfilePatch): Promise<ServiceResult<User>> {
  if (patch.name !== undefined && !patch.name.trim()) {
    return fail('EMPTY_NAME', 'Enter your name.');
  }
  if (patch.avatarUrl && patch.avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return fail('AVATAR_TOO_LARGE', 'That image is too large - try a smaller photo.');
  }
  if (patch.avatarUrl && !patch.avatarUrl.startsWith('data:image/')) {
    return fail('INVALID_AVATAR', 'That does not look like an image.');
  }

  const user = await db.user.update({
    where: { id: userId },
    data: {
      name: patch.name?.trim(),
      phone: patch.phone !== undefined ? patch.phone.trim() || null : undefined,
      avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl.trim() || null : undefined,
    },
  });

  return ok(toUserDto(user));
}
