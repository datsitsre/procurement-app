# Deployment

Status: reviewed, not run end-to-end in this environment. `docker` is not installed here, so the
Dockerfile below has been read carefully and matches the standard Next.js `output: 'standalone'`
pattern, but has not itself been built and run. Verify it once before relying on it in production.

## Runtime requirements

- Node.js >= 22 (see `package.json` `engines`; the Dockerfile uses `node:22-alpine`)
- PostgreSQL 17 (see `prisma/schema.prisma`)
- All variables in [.env.example](.env.example) set to real values - `.env.example` itself
  documents what each one is for and which routes fail closed while it's unset

## Building and running with Docker

```bash
docker build -t b2b-procurement .
docker run -p 3000:3000 --env-file .env b2b-procurement
```

The image is a multi-stage build producing Next.js's `standalone` output (`next.config.ts` sets
`output: 'standalone'`) - the runtime stage carries only the traced-in `node_modules`, not a full
`npm install`, and runs as a non-root user.

## Database migrations

Migrations are not run inside the Docker build (the build stage has no database to connect to).
Run them as a separate step against the target database before starting new instances:

```bash
npx prisma migrate deploy
```

This is the production-safe counterpart to `prisma migrate dev` (which is dev-only - it can
reset the database) - it only applies migrations already committed under `prisma/migrations/`.

## Background jobs

There's no persistent worker process or job queue - `/api/cron/invoice-due-sweep` and
`/api/cron/low-stock-sweep` are plain authenticated POST routes meant to be triggered by an
external scheduler once the app is running:

- **Vercel Cron** (`vercel.json` `crons` config) if deploying to Vercel
- A **GitHub Actions scheduled workflow** running `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/<job>`
- **System crontab + curl** on a self-hosted box

Point either job at roughly an hourly interval. Both fail closed (401) until `CRON_SECRET` is
set to the same value the scheduler sends as the `x-cron-secret` header - see `.env.example` for
the exact routes and what each one does.

## Health check

`GET /api/health` returns `{"status":"ok","checks":{"database":"ok"}}` (200) when the app can
reach its database - point your platform's health check / load balancer probe at it.

## What's intentionally not here yet

- **Redis-backed rate limiting** - `src/server/auth/rate-limit.ts` is in-memory today, correct
  for a single instance. Needed only once this deploys as more than one instance behind a load
  balancer; the file already documents this as a deferred decision, not an oversight.
- **File/document storage** - the `Document` Prisma model exists in the schema but no frontend
  page references attachments yet, so there's nothing to wire up. `.env.example`'s `STORAGE_*`
  vars are placeholders for when that UI exists.
