// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

/** Structured logging (section 10/30) - verifies the shape of what gets written and, most
 *  importantly, that sensitive fields never reach the log line even if a call site accidentally
 *  passes one. */
describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('writes a single-line JSON entry with timestamp, level, and message', () => {
    logger.info('request received', { route: '/api/auth/login', method: 'POST' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('request received');
    expect(entry.route).toBe('/api/auth/login');
    expect(entry.method).toBe('POST');
    expect(typeof entry.timestamp).toBe('string');
    expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('routes warn and error to their own console methods, not console.log', () => {
    logger.warn('rejected origin', { route: '/api/auth/login' });
    logger.error('unhandled failure', { route: '/api/payments' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('never lets a password, token, or secret-shaped field reach the log line', () => {
    logger.info('login attempt', {
      route: '/api/auth/login',
      password: 'hunter2',
      sessionToken: 'abc123',
      apiKey: 'sk_live_xyz',
      cardNumber: '4242424242424242',
      cvv: '123',
    } as never);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.password).toBe('[redacted]');
    expect(entry.sessionToken).toBe('[redacted]');
    expect(entry.apiKey).toBe('[redacted]');
    expect(entry.cardNumber).toBe('[redacted]');
    expect(entry.cvv).toBe('[redacted]');
  });

  it('redaction is case-insensitive on the key', () => {
    logger.info('test', { Password: 'x', SESSION_TOKEN: 'y' } as never);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.Password).toBe('[redacted]');
    expect(entry.SESSION_TOKEN).toBe('[redacted]');
  });

  it('leaves ordinary, non-sensitive fields untouched', () => {
    logger.info('request completed', { requestId: 'req-1', status: 200, durationMs: 42, userId: 'user-1' });
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.requestId).toBe('req-1');
    expect(entry.status).toBe(200);
    expect(entry.durationMs).toBe(42);
    expect(entry.userId).toBe('user-1');
  });
});
