import { NextResponse } from 'next/server';
import { checkDependencies } from '@/server/health';

/**
 * Health check (section 18/32). Deliberately unauthenticated (a load balancer or uptime monitor
 * needs to reach it without credentials) and deliberately minimal - it must never leak
 * infrastructure detail (connection strings, stack traces, internal hostnames) to a public
 * caller, only a coarse up/down signal per dependency.
 *
 * Kept behaviorally unchanged (same dependency check, same response shape) for anything that may
 * already poll this specific path - see /api/ready for the readiness-conventional path an
 * orchestrator's readinessProbe/target-group health check would more typically expect.
 */
export async function GET() {
  const { healthy, checks } = await checkDependencies();
  return NextResponse.json({ status: healthy ? 'ok' : 'degraded', checks }, { status: healthy ? 200 : 503 });
}
