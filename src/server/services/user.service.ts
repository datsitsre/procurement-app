import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toUserDto } from '@/server/dto/company';
import type { ServiceError, ServiceResult, UUID } from '@/types/common';
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

/** Shared by updateUserProfile (self-service) and company.service.ts's updateTeamMember (an
 *  admin setting a photo for someone else, e.g. before they've ever logged in) - same column,
 *  same constraints, whichever caller is writing it. Returns the failed branch of a
 *  ServiceResult to return as-is (assignable to ServiceResult<T> for any T - it never carries
 *  `data`), or null when `avatarUrl` is fine (including undefined/empty - "leave untouched"/
 *  "clear" are both valid, not validated against the data:image/ shape check). */
export function validateAvatarUrl(avatarUrl: string | undefined): { ok: false; error: ServiceError } | null {
  if (!avatarUrl) return null;
  if (avatarUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return { ok: false, error: { code: 'AVATAR_TOO_LARGE', message: 'That image is too large - try a smaller photo.' } };
  }
  if (!avatarUrl.startsWith('data:image/')) {
    return { ok: false, error: { code: 'INVALID_AVATAR', message: 'That does not look like an image.' } };
  }
  return null;
}

export async function updateUserProfile(userId: UUID, patch: UserProfilePatch): Promise<ServiceResult<User>> {
  if (patch.name !== undefined && !patch.name.trim()) {
    return fail('EMPTY_NAME', 'Enter your name.');
  }
  const avatarError = validateAvatarUrl(patch.avatarUrl);
  if (avatarError) return avatarError;

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
