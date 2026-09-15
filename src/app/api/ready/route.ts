import { NextResponse } from 'next/server';
import { checkDependencies } from '@/server/health';

/**
 * Readiness check (section 18) - answers "can this instance currently serve normal application
 * traffic?", the question a load balancer's target-group health check or an orchestrator's
 * readinessProbe conventionally asks at this specific path, distinct from a liveness check
 * ("is the process still running at all?", which /api/health also serves for anything already
 * polling it under that name).
 *
 * For this app, the two currently share the same answer - critical-dependency reachability (the
 * database) is the only thing that determines whether a request here could actually succeed, so
 * this delegates to the same check rather than inventing a second, different signal purely to
 * seem more sophisticated. If a real distinct readiness concern shows up later (a warm-cache
 * requirement, a pending-migration gate), it belongs here without touching /api/health's
 * existing, possibly-already-depended-on behavior.
 */
export async function GET() {
  const { healthy, checks } = await checkDependencies();
  return NextResponse.json({ status: healthy ? 'ready' : 'not_ready', checks }, { status: healthy ? 200 : 503 });
}
