import 'server-only';
import { randomBytes, createHash } from 'crypto';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { hashPassword } from '@/server/auth/password';
import type { ServiceResult, UUID } from '@/types/common';

/**
 * Password reset (Part B6 - Company User Management follow-up). `PasswordResetToken` already
 * existed in the schema before this phase but had zero behavior anywhere in the codebase - no
 * service, no route, nothing ever created or consumed a row (confirmed by inspection). This is
 * the first real implementation, not a fix to something broken.
 *
 * Follows the exact same raw-token-in-the-link/only-a-hash-in-the-database pattern
 * server/auth/session.ts's own session tokens already use - a leaked database dump alone can
 * never be replayed as a valid reset link. The raw token is shown to the triggering admin (or,
 * for a genuine self-service "forgot password" flow, would be emailed - this app has no email
 * delivery, the same limitation addTeamMember's temporaryPassword already documents) exactly
 * once, the same "no email delivery, show once" pattern already established there.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface PasswordResetRequest {
  token: string;
  expiresAt: string;
}

/** Issues a one-time reset token for `userId`. Never returns or logs the previous password, and
 *  the token itself is never persisted in plaintext - only its SHA-256 hash. Callers (e.g. a
 *  company admin resetting a team member's password) are responsible for their own authorization
 *  check before calling this - this function trusts `userId` exactly as far as that. */
export async function requestPasswordReset(userId: UUID): Promise<ServiceResult<PasswordResetRequest>> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail('NOT_FOUND', 'That user could not be found.');

  const token = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.passwordResetToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });

  return ok({ token, expiresAt: expiresAt.toISOString() });
}

/** Completes a reset - the user themselves supplies the raw token (from the link/value they were
 *  given) plus their own new password. Single-use (`usedAt`) and time-limited (`expiresAt`) -
 *  both checked with a real database round trip, never inferred client-side. Never reveals
 *  whether a token is invalid because it expired, was already used, or never existed - all three
 *  collapse to the same generic failure, the same "don't leak which part was wrong" principle
 *  login's own error handling already follows. */
export async function completePasswordReset(token: string, newPassword: string): Promise<ServiceResult<{ userId: UUID }>> {
  if (newPassword.length < 8) return fail('WEAK_PASSWORD', 'Choose a password with at least 8 characters.');

  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return fail('INVALID_TOKEN', 'This reset link is invalid or has expired. Ask for a new one.');
  }

  const passwordHash = await hashPassword(newPassword);
  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  return ok({ userId: record.userId });
}
