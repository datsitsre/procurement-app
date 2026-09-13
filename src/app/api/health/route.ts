import { NextResponse } from 'next/server';
import { db } from '@/server/db';

/**
 * Basic liveness/readiness check (section 32). Deliberately unauthenticated (a load balancer or
 * uptime monitor needs to reach it without credentials) and deliberately minimal - it must never
 * leak infrastructure detail (connection strings, stack traces, internal hostnames) to a public
 * caller, only a coarse up/down signal per dependency.
 */
export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  const healthy = Object.values(checks).every((status) => status === 'ok');

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    { status: healthy ? 200 : 503 },
  );
}
