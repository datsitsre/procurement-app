import { afterEach, describe, expect, it, vi } from 'vitest';
import { authService } from './auth.service';

/**
 * Regression coverage for the Phase 26 UI-alignment fix: before this, `register()` always
 * expected the ACTIVE-session shape `/api/auth/register` used to return, so a real
 * PENDING_APPROVAL response (no `activeCompanyId`) fell through to a generic
 * "Registration failed. Please try again." even though the account was created successfully.
 * `login()` had the same blind spot for an account with zero active memberships - it couldn't
 * tell "pending approval" apart from "rejected" apart from "no company at all".
 */
function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authService.register', () => {
  it('surfaces a PENDING_APPROVAL result as success, not a false "registration failed"', async () => {
    mockFetchOnce(200, { registrationStatus: 'PENDING_APPROVAL', message: 'Your account is awaiting approval.' });

    const result = await authService.register({
      companyName: 'Test Co',
      country: 'GH',
      currency: 'GHS',
      fullName: 'Test User',
      email: 'test@example.test',
      password: 'a-real-password-123',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.registrationStatus).toBe('PENDING_APPROVAL');
      expect(result.data.message).toBe('Your account is awaiting approval.');
    }
  });

  it('still surfaces a real validation error as a failure', async () => {
    mockFetchOnce(422, { error: 'Invalid request.', fieldErrors: { email: 'Enter a valid email.' } });

    const result = await authService.register({
      companyName: 'Test Co',
      country: 'GH',
      currency: 'GHS',
      fullName: 'Test User',
      email: 'not-an-email',
      password: 'a-real-password-123',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fieldErrors?.email).toBe('Enter a valid email.');
    }
  });
});

describe('authService.login - membership-status-aware messaging', () => {
  it('explains a PENDING_APPROVAL account clearly instead of a generic "no company" message', async () => {
    mockFetchOnce(200, {
      user: { id: 'u1', name: 'Test User', email: 'test@example.test', createdAt: new Date().toISOString() },
      memberships: [],
      activeCompanyId: null,
      companies: [],
      membershipStatus: 'PENDING_APPROVAL',
    });

    const result = await authService.login('test@example.test', 'a-real-password-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/awaiting approval/i);
    }
  });

  it('explains a REJECTED account distinctly from a pending one', async () => {
    mockFetchOnce(200, {
      user: { id: 'u1', name: 'Test User', email: 'test@example.test', createdAt: new Date().toISOString() },
      memberships: [],
      activeCompanyId: null,
      companies: [],
      membershipStatus: 'REJECTED',
    });

    const result = await authService.login('test@example.test', 'a-real-password-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/not approved/i);
    }
  });

  it('falls back to the generic message when there is no membership at all', async () => {
    mockFetchOnce(200, {
      user: { id: 'u1', name: 'Test User', email: 'test@example.test', createdAt: new Date().toISOString() },
      memberships: [],
      activeCompanyId: null,
      companies: [],
      membershipStatus: null,
    });

    const result = await authService.login('test@example.test', 'a-real-password-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('This account is not linked to any company yet.');
    }
  });

  it('succeeds normally for an ACTIVE account with a real company', async () => {
    mockFetchOnce(200, {
      user: { id: 'u1', name: 'Test User', email: 'test@example.test', createdAt: new Date().toISOString() },
      memberships: [{ id: 'm1', companyId: 'c1', userId: 'u1', role: 'OWNER', status: 'ACTIVE' }],
      activeCompanyId: 'c1',
      companies: [
        {
          id: 'c1', name: 'Test Co', country: 'GH', currency: 'GHS', addresses: [],
          creditTerms: 'NET_30', isSupplier: false, isBuyer: true, createdAt: new Date().toISOString(),
        },
      ],
    });

    const result = await authService.login('test@example.test', 'a-real-password-123');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.activeCompanyId).toBe('c1');
    }
  });
});
