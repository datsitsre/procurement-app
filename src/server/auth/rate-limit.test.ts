// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkRateLimit, recordAttempt, clearAttempts, enforceRateLimit } from './rate-limit';

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
  });
});
