/**
 * The single Prisma Client instance for the whole server (section 37 - "database connection
 * pooling", "stateless API instances where practical"). Next.js dev mode hot-reloads server
 * modules on every file change; without caching the client on `globalThis`, each reload would
 * open a brand new pool of Postgres connections and quickly exhaust the database's connection
 * limit. This is the standard Prisma-with-Next.js pattern, not something specific to this app.
 */
import 'server-only';
import { PrismaClient } from '@prisma/client';
import { env, isProduction } from './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: env.DATABASE_URL,
    log: isProduction ? ['error'] : ['warn', 'error'],
  });

if (!isProduction) globalForPrisma.prisma = db;
