import 'server-only';
import { db } from '@/server/db';

/**
 * Shared dependency check behind both /api/health and /api/ready (section 18). Deliberately
 * minimal - never leaks infrastructure detail (connection strings, stack traces, internal
 * hostnames) to a caller, only a coarse up/down signal per dependency.
 */
export async function checkDependencies(): Promise<{ healthy: boolean; checks: Record<string, 'ok' | 'error'> }> {
  const checks: Record<string, 'ok' | 'error'> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  return { healthy: Object.values(checks).every((status) => status === 'ok'), checks };
}
