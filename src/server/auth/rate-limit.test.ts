// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkRateLimit, recordAttempt, clearAttempts } from './rate-limit';

describe('login rate limiting (section 7 - brute-force protection)', () => {
  it('allows attempts under the limit', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 9; i++) {
      expect(checkRateLimit(key)).toBe(true);
      recordAttempt(key);
    }
  });

  it('blocks once the limit is reached', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) recordAttempt(key);
    expect(checkRateLimit(key)).toBe(false);
  });

  it('clearing attempts (a successful login) resets the counter', () => {
    const key = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) recordAttempt(key);
    expect(checkRateLimit(key)).toBe(false);
    clearAttempts(key);
    expect(checkRateLimit(key)).toBe(true);
  });

  it('keys are independent - one email/IP being rate-limited does not block another', () => {
    const blocked = `test:blocked:${crypto.randomUUID()}`;
    const fresh = `test:fresh:${crypto.randomUUID()}`;
    for (let i = 0; i < 10; i++) recordAttempt(blocked);
    expect(checkRateLimit(blocked)).toBe(false);
    expect(checkRateLimit(fresh)).toBe(true);
  });
});
