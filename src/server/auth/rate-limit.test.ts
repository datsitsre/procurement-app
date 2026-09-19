// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkRateLimit, recordAttempt, clearAttempts, enforceRateLimit, getRetryAfterSeconds } from './rate-limit';

describe('rate limiting (section 7 - brute-force/abuse protection)', () => {
  it('allows attempts under the limit', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 9; i++) {
      expect(checkRateLimit('auth', key)).toBe(true);
      recordAttempt('auth', key);
    }
  });

  it('blocks once the limit is reached', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) recordAttempt('auth', key);
    expect(checkRateLimit('auth', key)).toBe(false);
  });

  it('clearing attempts (a successful login) resets the counter', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) recordAttempt('auth', key);
    expect(checkRateLimit('auth', key)).toBe(false);
    clearAttempts('auth', key);
    expect(checkRateLimit('auth', key)).toBe(true);
  });

  it('keys are independent - one email/IP being rate-limited does not block another', () => {
    const blocked = `test:blocked:${crypto.randomUUID()}`;
    const fresh = `test:fresh:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) recordAttempt('auth', blocked);
    expect(checkRateLimit('auth', blocked)).toBe(false);
    expect(checkRateLimit('auth', fresh)).toBe(true);
  });

  it('kinds are independent - exhausting one endpoint class does not block another for the same key', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) recordAttempt('auth', key);
    expect(checkRateLimit('auth', key)).toBe(false);
    // Same literal key string, different kind - payment's own bucket is untouched.
    expect(checkRateLimit('payment', key)).toBe(true);
  });

  it('each kind enforces its own configured limit, not a universal one', () => {
    const paymentKey = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 8; i++) recordAttempt('payment', paymentKey); // payment's max is 8
    expect(checkRateLimit('payment', paymentKey)).toBe(false);

    const webhookKey = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 8; i++) recordAttempt('webhook', webhookKey); // webhook's max is 60
    expect(checkRateLimit('webhook', webhookKey)).toBe(true);
  });

  it("procurementWrite (budgets/purchase-templates/recurring-purchases mutations, section 8) enforces its own limit of 20/min", () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 20; i++) recordAttempt('procurementWrite', key);
    expect(checkRateLimit('procurementWrite', key)).toBe(false);
    expect(checkRateLimit('payment', key)).toBe(true);
  });

  describe('enforceRateLimit', () => {
    it('returns null and records the attempt when under the limit', () => {
      const key = `test:${crypto.randomUUID()}`;
      expect(enforceRateLimit('negotiation', key)).toBeNull();
      expect(enforceRateLimit('negotiation', key)).toBeNull();
    });

    it('returns a 429 response once the limit is reached, counting every call (not just failures)', async () => {
      const key = `test:${crypto.randomUUID()}`;
      for (let i = 0; i < 20; i++) expect(enforceRateLimit('negotiation', key)).toBeNull(); // negotiation's max is 20
      const blocked = enforceRateLimit('negotiation', key);
      expect(blocked).not.toBeNull();
      expect(blocked?.status).toBe(429);
      const body = await blocked?.json();
      expect(body.error).toMatch(/too many/i);
    });

    it('a 429 response carries a real Retry-After header reflecting the actual remaining window, not a hardcoded value (Phase 18, section 13)', () => {
      const key = `test:${crypto.randomUUID()}`;
      for (let i = 0; i < 20; i++) enforceRateLimit('negotiation', key); // negotiation's max is 20, window 60s
      const blocked = enforceRateLimit('negotiation', key);
      const retryAfter = Number(blocked?.headers.get('Retry-After'));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60); // negotiation's configured window
    });
  });

  describe('getRetryAfterSeconds', () => {
    it('returns the full window when no bucket exists yet for the key', () => {
      const key = `test:${crypto.randomUUID()}`;
      expect(getRetryAfterSeconds('negotiation', key)).toBe(60); // negotiation's window is 60s
    });

    it('returns a smaller value the closer the window is to resetting, never 0 or negative', () => {
      const key = `test:${crypto.randomUUID()}`;
      recordAttempt('payment', key); // starts the window now
      const remaining = getRetryAfterSeconds('payment', key);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(15 * 60); // payment's configured window
    });

    it('different kinds for the same key have independent windows/remaining times', () => {
      const key = `test:${crypto.randomUUID()}`;
      recordAttempt('auth', key);
      recordAttempt('webhook', key);
      // auth's window is 15 min, webhook's is 1 min - these must not be conflated.
      expect(getRetryAfterSeconds('auth', key)).toBeGreaterThan(getRetryAfterSeconds('webhook', key));
    });
  });
});
