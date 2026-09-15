import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/server/observability/logger';

/**
 * Standardized backend error handling (section 12/13). The audit found route error responses
 * are hand-built per route - consistent in *practice* (every route was written against the same
 * `{ error: string }` convention by hand) but nothing enforced it centrally. This gives new/
 * high-risk routes (section 12's own scoping - not a rewrite of all 83 routes) a shared,
 * reviewable mapping from a typed error to an HTTP response, and - the actually load-bearing
 * part - a safety net for anything *unexpected* that throws, so a genuinely uncaught error (a
 * Prisma error, a bug) can never reach the client as anything but a generic, safe message.
 *
 * Next.js's own default handling for an uncaught Route Handler exception was verified live
 * (production build) to already return an empty-body 500 - no stack trace, no SQL, no file
 * paths - so this isn't closing an active leak. It exists for two real reasons instead: an
 * empty body breaks this app's own `{ error: string }` response contract client code expects,
 * and Next's default error log isn't correlated to this app's own requestId/structured log
 * format.
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** A known, intentional API error - the message is safe to show a caller as-is (never build one
 *  of these from a raw caught exception's own message, which may carry internal detail). */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: ApiErrorCode, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Invalid request.', fieldErrors?: Record<string, string>) {
    super('VALIDATION_ERROR', message, fieldErrors);
  }
}
export class AuthenticationError extends ApiError {
  constructor(message = 'Authentication required.') {
    super('AUTHENTICATION_ERROR', message);
  }
}
export class AuthorizationError extends ApiError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('AUTHORIZATION_ERROR', message);
  }
}
export class NotFoundError extends ApiError {
  constructor(message = 'That resource could not be found.') {
    super('NOT_FOUND', message);
  }
}
export class ConflictError extends ApiError {
  constructor(message = 'This request conflicts with the current state.') {
    super('CONFLICT', message);
  }
}
export class RateLimitError extends ApiError {
  constructor(message = 'Too many requests. Try again later.') {
    super('RATE_LIMITED', message);
  }
}

/** Converts any thrown value into a safe `NextResponse` - an `ApiError` maps to its own code/
 *  status/message/fieldErrors; anything else (a raw Prisma error, a programming bug, literally
 *  anything) is logged server-side in full (with `requestId` and `route` for correlation) and
 *  answered with a generic, non-revealing message. This is the one place in the app allowed to
 *  log/inspect a raw caught exception's internals - every caller of this function hands it the
 *  original error and gets back something guaranteed safe to send a client. */
export function toSafeErrorResponse(error: unknown, context: { requestId?: string; route: string }): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) },
      { status: STATUS_BY_CODE[error.code] },
    );
  }

  logger.error('unhandled route exception', {
    requestId: context.requestId,
    route: context.route,
    errorCode: 'INTERNAL_ERROR',
    // Never re-thrown or exposed - message/stack are logged server-side only, for a human
    // reading logs with a requestId in hand, never sent in the response body itself.
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return NextResponse.json({ error: 'Unable to process request.', requestId: context.requestId }, { status: 500 });
}

/** Wraps a route handler so any thrown `ApiError` or unexpected exception is converted through
 *  `toSafeErrorResponse` instead of either leaking a hand-rolled error response shape or falling
 *  through to Next's own bare empty-body 500. Opt-in per route (section 12 - new/high-risk
 *  routes, not a blanket rewrite of all 83). */
export function withErrorHandling<Args extends unknown[]>(
  route: string,
  handler: (request: NextRequest, ...args: Args) => Promise<NextResponse>,
): (request: NextRequest, ...args: Args) => Promise<NextResponse> {
  return async (request, ...args) => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      const requestId = request.headers.get('x-request-id') ?? undefined;
      return toSafeErrorResponse(error, { requestId, route });
    }
  };
}
