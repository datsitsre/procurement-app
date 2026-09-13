import 'server-only';

/**
 * Brute-force protection for login attempts (section 7). This is an in-memory, per-process
 * sliding-window limiter - correct and sufficient for a single instance, but it does NOT
 * coordinate across multiple server instances behind a load balancer. Section 16/37's note
 * applies here: don't add Redis until the deployment actually needs more than one instance: when
 * it does, swap this module's storage for a Redis-backed counter without changing its call
 * sites (`checkRateLimit` / `recordAttempt` is the whole surface a Redis version would need).
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

interface Bucket {
  count: number;
  windowStartedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Cheap, bounded cleanup so `buckets` can't grow forever across a long-running process - runs
 *  on a fraction of calls rather than its own timer, so this module has no background interval
 *  to manage or leak. */
function sweepExpired(now: number) {
  if (Math.random() > 0.01) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt > WINDOW_MS) buckets.delete(key);
  }
}

/** Returns true if `key` (e.g. `login:<ip>:<email>`) is still allowed to attempt. Does not
 *  itself record the attempt - call `recordAttempt` after a failed one. */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  sweepExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartedAt > WINDOW_MS) return true;
  return bucket.count < MAX_ATTEMPTS;
}

export function recordAttempt(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartedAt > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStartedAt: now });
    return;
  }
  bucket.count += 1;
}

/** Clears a key's attempts (a successful login should reset the counter for that key). */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}
