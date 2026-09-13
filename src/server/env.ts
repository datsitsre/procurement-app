/**
 * Server-only environment configuration (section 25). Every environment variable the backend
 * depends on is read and validated exactly once, here - nowhere else in the server codebase
 * should reach for `process.env` directly, so a missing/malformed value fails loudly at startup
 * instead of surfacing as a confusing runtime error deep inside a request handler.
 *
 * This module must never be imported from a `'use client'` file - importing it there would be a
 * build error anyway (server-only env vars aren't available to the client bundle), but the
 * explicit `import 'server-only'` makes that mistake fail immediately and clearly rather than
 * silently inlining `undefined`.
 */
import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value === 'CHANGE_ME') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill in a real value.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  NODE_ENV: optional('NODE_ENV', 'development') as 'development' | 'test' | 'staging' | 'production',
  DATABASE_URL: required('DATABASE_URL'),
  AUTH_SECRET: required('AUTH_SECRET'),
  SESSION_TTL_SECONDS: Number(optional('SESSION_TTL_SECONDS', '604800')),
};

export const isProduction = env.NODE_ENV === 'production';
