import 'server-only';
import { randomBytes, createHash } from 'crypto';
import type { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { env, isProduction } from '@/server/env';

export const SESSION_COOKIE_NAME = 'session_token';

/** Sets the session cookie on a response - httpOnly (never readable by client JS, defeating
 *  most XSS-driven token theft), sameSite=lax (sent on top-level navigation but not on
 *  cross-site POSTs, a first line of CSRF defense - see requireSameOrigin() for mutations),
 *  secure in production only (a local http dev server can't set a secure cookie). */
export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, '', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** The raw token is what goes in the cookie; only its SHA-256 hash is ever persisted, the same
 *  principle as password hashing - a leaked database dump alone can't be replayed as a live
 *  session, and this table can't be used to "recover" a session token for support purposes. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateSessionInput {
  userId: string;
  activeCompanyId?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/** Creates a new session row and returns the raw token to set as the cookie value. Called once
 *  at login; nothing else in the request pipeline ever needs the raw token again. */
export async function createSession(input: CreateSessionInput): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

  await db.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      activeCompanyId: input.activeCompanyId,
      userAgent: input.userAgent ?? undefined,
      ipAddress: input.ipAddress ?? undefined,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  activeCompanyId: string | null;
}

/** Verifies a raw session token from a cookie against the database - expired or revoked sessions
 *  fail closed (return null), never partially trusted. This is the one place "is this session
 *  still valid" is decided; every protected route goes through it rather than re-implementing
 *  its own expiry/revocation check. */
export async function verifySessionToken(token: string): Promise<AuthenticatedSession | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  return {
    sessionId: session.id,
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    activeCompanyId: session.activeCompanyId,
  };
}

/** Revokes one session (logout) - the row is kept (not deleted) so a security review can still
 *  see it was issued and when it was ended, rather than losing that history entirely. */
export async function revokeSession(token: string): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every session for a user ("log out of all devices" / forced logout after a password
 *  change) - section 7's requirement that a session can be revoked without a blocklist. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function setActiveCompany(sessionId: string, companyId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } });
}
