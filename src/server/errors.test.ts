// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  toSafeErrorResponse,
  withErrorHandling,
} from './errors';

/** Standardized error handling (section 12/13) - verifies each typed error maps to the right
 *  status/body, and that anything unexpected (a raw thrown error, a Prisma-shaped error) is
 *  logged server-side but never exposes its own message/stack to the response body. */
describe('toSafeErrorResponse', () => {
  it.each([
    [new ValidationError('Invalid request.', { email: 'Required' }), 422, 'Invalid request.'],
    [new AuthenticationError(), 401, 'Authentication required.'],
    [new AuthorizationError(), 403, 'You do not have permission to perform this action.'],
    [new NotFoundError('That invoice could not be found.'), 404, 'That invoice could not be found.'],
    [new ConflictError('Already processed.'), 409, 'Already processed.'],
    [new RateLimitError(), 429, 'Too many requests. Try again later.'],
  ] as const)('maps %s to the right status and message', async (error, status, message) => {
    const response = toSafeErrorResponse(error, { route: '/api/test', requestId: 'req-1' });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toBe(message);
  });

  it('includes fieldErrors on a ValidationError when present', async () => {
    const response = toSafeErrorResponse(new ValidationError('Invalid request.', { email: 'Required' }), { route: '/api/test' });
    const body = await response.json();
    expect(body.fieldErrors).toEqual({ email: 'Required' });
  });

  it('a raw, unexpected exception (e.g. a database error) never exposes its own message to the client', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dbError = new Error('relation "Users" does not exist at /app/src/server/db.ts:42, connection string postgres://user:pass@host');
    const response = toSafeErrorResponse(dbError, { route: '/api/test', requestId: 'req-2' });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Unable to process request.');
    expect(body.error).not.toContain('postgres://');
    expect(body.error).not.toContain('relation');
    expect(body.requestId).toBe('req-2');
    errorSpy.mockRestore();
  });

  it('logs the real error server-side (with requestId/route) even though the response is generic', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    toSafeErrorResponse(new Error('boom'), { route: '/api/test', requestId: 'req-3' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.requestId).toBe('req-3');
    expect(logged.route).toBe('/api/test');
    expect(logged.errorMessage).toBe('boom');
    errorSpy.mockRestore();
  });

  it('a non-Error thrown value (e.g. a string) is still handled safely', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = toSafeErrorResponse('a raw string throw', { route: '/api/test' });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Unable to process request.');
    errorSpy.mockRestore();
  });
});

describe('withErrorHandling', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('passes through a normal response untouched', async () => {
    const handler = withErrorHandling('/api/test', async () => NextResponse.json({ ok: true }));
    const response = await handler(new NextRequest('http://localhost/api/test'));
    expect(response.status).toBe(200);
  });

  it('catches an ApiError thrown inside the handler and maps it safely', async () => {
    const handler = withErrorHandling('/api/test', async () => {
      throw new NotFoundError('Missing.');
    });
    const response = await handler(new NextRequest('http://localhost/api/test'));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Missing.');
  });

  it('catches an unexpected exception and never leaks it, using the request id from the request headers', async () => {
    const handler = withErrorHandling('/api/test', async () => {
      throw new Error('unexpected database failure at /internal/path');
    });
    const response = await handler(new NextRequest('http://localhost/api/test', { headers: { 'x-request-id': 'req-4' } }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Unable to process request.');
    expect(body.requestId).toBe('req-4');
  });
});
