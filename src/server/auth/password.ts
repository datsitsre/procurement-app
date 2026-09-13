import 'server-only';
import bcrypt from 'bcryptjs';

/** Cost factor for bcrypt - 12 is a reasonable balance of security vs. login latency for 2026
 *  hardware; re-tune upward as hardware gets faster (OWASP's guidance moves over time). */
const BCRYPT_ROUNDS = 12;

/** Hashes a plaintext password for storage. Never store or log the plaintext value itself -
 *  every caller of this must discard `password` immediately after calling it. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Verifies a plaintext password against a stored hash. Always returns a boolean - never throws
 *  on a mismatch, so callers can't accidentally leak "user exists but wrong password" vs. "user
 *  doesn't exist" through different error shapes (see auth API's constant-shape error response). */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
