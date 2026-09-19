import 'server-only';
import { NextResponse } from 'next/server';

/**
 * Brute-force / abuse protection (section 7, extended). This is an in-memory, per-process
 * sliding-window limiter - correct and sufficient for a single instance, but it does NOT
 * coordinate across multiple server instances behind a load balancer. Section 16/37's note
 * applies here: don't add Redis until the deployment actually needs more than one instance; when
 * it does, swap this module's storage for a Redis-backed counter without changing its call sites
 * (`checkRateLimit` / `recordAttempt` / `enforceRateLimit` is the whole surface a Redis version
 * would need).
 *
 * Different endpoint classes get different windows/limits - a single universal number is either
 * too loose for auth/payment endpoints or too strict for a webhook provider's normal retry
 * traffic, so each `RateLimitKind` has its own bucket namespace and its own config below.
 */

export type RateLimitKind = 'auth' | 'payment' | 'webhook' | 'negotiation' | 'rfqCreate' | 'procurementWrite';

const LIMITS: Record<RateLimitKind, { windowMs: number; max: number }> = {
  // Login/register - brute-force credential guessing and mass fake-account creation.
  auth: { windowMs: 15 * 60 * 1000, max: 10 },
  // Invoice payment attempts - a failed/retried charge is expensive to the payment provider and
  // a tight window limits both card-testing abuse and runaway retry loops.
  payment: { windowMs: 15 * 60 * 1000, max: 8 },
  // Inbound provider webhooks - generous, since a real provider's own retry policy can legitimately
  // resend the same or related events; this exists to bound signature-guessing spam, not to
  // throttle normal delivery.
  webhook: { windowMs: 60 * 1000, max: 60 },
  // Negotiation messages - generous enough for a real back-and-forth conversation, tight enough
  // to stop a scripted flood into another company's negotiation thread.
  negotiation: { windowMs: 60 * 1000, max: 20 },
  // RFQ creation - each one fans out to every invited supplier, so this is closer to a bulk-send
  // action than an ordinary write.
  rfqCreate: { windowMs: 60 * 60 * 1000, max: 30 },
  // Budget/purchase-template/recurring-purchase create-update-delete, and the manual "run due
  // schedules now" sweep trigger (Phase 16, section 8) - generous enough for real admin
  // configuration work, tight enough to stop a scripted flood of writes or repeated sweep runs.
  procurementWrite: { windowMs: 60 * 1000, max: 20 },
};

interface Bucket {
  count: number;
  windowStartedAt: number;
}

const buckets = new Map<string, Bucket>();

function bucketKey(kind: RateLimitKind, key: string): string {
  return `${kind}:${key}`;
}

/** Cheap, bounded cleanup so `buckets` can't grow forever across a long-running process - runs
 *  on a fraction of calls rather than its own timer, so this module has no background interval
 *  to manage or leak. */
function sweepExpired(now: number) {
  if (Math.random() > 0.01) return;
  for (const [mapKey, bucket] of buckets) {
    const kind = mapKey.slice(0, mapKey.indexOf(':')) as RateLimitKind;
    const windowMs = LIMITS[kind]?.windowMs ?? LIMITS.auth.windowMs;
    if (now - bucket.windowStartedAt > windowMs) buckets.delete(mapKey);
  }
}

/** Returns true if `key` is still allowed to attempt under `kind`'s configured window/limit.
 *  Does not itself record the attempt - call `recordAttempt` (or use `enforceRateLimit`, which
 *  does both in one call). */
export function checkRateLimit(kind: RateLimitKind, key: string): boolean {
  const now = Date.now();
  sweepExpired(now);
  const { windowMs, max } = LIMITS[kind];
  const bucket = buckets.get(bucketKey(kind, key));
  if (!bucket || now - bucket.windowStartedAt > windowMs) return true;
  return bucket.count < max;
}

export function recordAttempt(kind: RateLimitKind, key: string): void {
  const now = Date.now();
  const { windowMs } = LIMITS[kind];
  const mapKey = bucketKey(kind, key);
  const bucket = buckets.get(mapKey);
  if (!bucket || now - bucket.windowStartedAt > windowMs) {
    buckets.set(mapKey, { count: 1, windowStartedAt: now });
    return;
  }
  bucket.count += 1;
}

/** Clears a key's attempts (e.g. a successful login should reset the counter for that key). */
export function clearAttempts(kind: RateLimitKind, key: string): void {
  buckets.delete(bucketKey(kind, key));
}

/** How many whole seconds until `key`'s current window resets, for the `Retry-After` header
 *  (section 13/Phase 18) - derived from the same bucket state `checkRateLimit` itself reads, so
 *  it can never drift from the real remaining window. If no bucket exists yet (a `checkRateLimit`
 *  call between two racing requests could plausibly see this), the full window is the correct,
 *  safe answer - the caller genuinely has the entire window ahead of them. Always at least 1, so
 *  a client is never told to retry after 0 seconds. */
export function getRetryAfterSeconds(kind: RateLimitKind, key: string): number {
  const { windowMs } = LIMITS[kind];
  const bucket = buckets.get(bucketKey(kind, key));
  if (!bucket) return Math.ceil(windowMs / 1000);
  const remainingMs = windowMs - (Date.now() - bucket.windowStartedAt);
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/** Check-and-record in one call, for endpoints where every request - successful or not - should
 *  count toward the limit (unlike login, which only counts failures so a legitimate user isn't
 *  penalized for their own successful sign-ins). Returns a ready-to-return 429 response (carrying
 *  a real, computed `Retry-After` header - section 13 - never a hardcoded value) when the caller
 *  is over limit, or null when the request may proceed. */
export function enforceRateLimit(kind: RateLimitKind, key: string): NextResponse | null {
  if (!checkRateLimit(kind, key)) {
    const response = NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
    response.headers.set('Retry-After', String(getRetryAfterSeconds(kind, key)));
    return response;
  }
  recordAttempt(kind, key);
  return null;
}
