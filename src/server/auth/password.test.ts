// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing (section 7)', () => {
  it('never stores the plaintext password in the hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('verifies a correct password against its own hash', async () => {
    const hash = await hashPassword('super-secret-1');
    await expect(verifyPassword('super-secret-1', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('super-secret-1');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt), even for the same password', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    await expect(verifyPassword('same-password', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password', b)).resolves.toBe(true);
  });
});
