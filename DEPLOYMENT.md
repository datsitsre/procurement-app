# Deployment

Status (Phase 23): the application is designed to run identically on either of two deployment
models, chosen at the infrastructure layer, never in application code:

- **Vercel** (primary target) - the Next.js app runs as Vercel's own managed Next.js runtime;
  Vercel Cron triggers the four background-job routes; a managed PostgreSQL provider, an
  S3-compatible bucket, and MTN MoMo supply the external services.
- **Docker + a VPS/VM, behind Nginx or Caddy** (portable fallback - "Option B") - the exact same
  application code, built from the same `Dockerfile`, behind a reverse proxy that terminates TLS,
  with an external scheduler (GitHub Actions or system crontab) triggering the same routes.

Nothing in `src/` imports a Vercel-specific SDK or depends on Vercel's runtime in any way - every
route is a standard Next.js Route Handler reachable over plain HTTP, the database access is plain
Prisma/PostgreSQL, and background jobs are plain authenticated HTTP endpoints. The only
Vercel-specific file in this repository is `vercel.json` (cron schedule declarations), which has
no effect at all on a non-Vercel deployment.

**Neither deployment model has actually been exercised end to end** - no Vercel account, no
managed PostgreSQL instance, no real object-storage bucket, no MTN MoMo sandbox credentials, and no
`docker` binary exist in the environment this repository's own work has been done in. See
`PHASE23_FINAL_REPORT.md` for the full evidence-classified account of what is and isn't verified.

## Runtime requirements (both deployment models)

- Node.js >= 22 (see `package.json` `engines`; the Dockerfile uses `node:22-alpine`; Vercel's own
  Next.js runtime auto-selects a compatible Node version)
- PostgreSQL 17 (see `prisma/schema.prisma`)
- All variables in [.env.example](.env.example) set to real values - `.env.example` itself
  documents what each one is for and which routes fail closed while it's unset

## Option A: Vercel

1. Import the repository into a Vercel project (standard Next.js App Router detection - no
   `vercel.json` build/runtime overrides are needed; the one `vercel.json` in this repo only
   declares cron schedules, covered below).
2. Set every variable from `.env.example` as a Vercel Environment Variable (Production
   environment) - `DATABASE_URL` pointing at a real managed PostgreSQL instance,
   `AUTH_SECRET`/`PAYMENT_WEBHOOK_SIGNING_SECRET`/`CRON_SECRET` as freshly generated production
   secrets, `NODE_ENV=production`, and the `MTN_MOMO_*`/`STORAGE_*` groups once those external
   services are actually provisioned.
3. Apply migrations against the production database before or during the first deploy:
   `npx prisma migrate deploy` (see Database migrations, below) - Vercel does not run this for you
   automatically; it must be a deploy-hook or manually-run step.
4. Deploy. Vercel Cron (declared in `vercel.json`) begins triggering the four cron routes on their
   configured schedules once `CRON_SECRET` is set as a project environment variable - see
   Background jobs, below, for the exact header Vercel sends and why the routes had to be adjusted
   for it.
5. Point the real MTN MoMo (or other configured network's) webhook configuration at
   `https://<your-domain>/api/webhooks/payments/[provider]` once real gateway credentials exist.

## Option B: Docker + VPS/VM

```bash
docker build -t b2b-procurement .
docker run -p 3000:3000 --env-file .env b2b-procurement
```

The image is a multi-stage build producing Next.js's `standalone` output (`next.config.ts` sets
`output: 'standalone'`) - the runtime stage carries only the traced-in `node_modules`, not a full
`npm install`, and runs as a non-root user. In this model:

- A reverse proxy (Nginx or Caddy) sits in front of the container, terminates TLS, and forwards
  plain HTTP to port 3000 - the application itself never terminates TLS (see TLS/domain, below).
- Migrations are applied the same way as Option A (`npx prisma migrate deploy`), run once against
  the target database, not inside the Docker build itself (the build stage has no database to
  connect to).
- The external scheduler is a GitHub Actions scheduled workflow or system crontab (not Vercel
  Cron, which only exists on Vercel) - see Background jobs, below.
- Object storage and payment configuration are identical to Option A - the same env vars, the same
  `StorageProvider`/`PaymentProvider` abstractions, no code difference between the two deployment
  models.
- If this deployment ever runs more than one container instance behind a load balancer, revisit
  the in-memory rate limiter (see "What's intentionally not here yet", below) before doing so -
  this is the one component in this codebase that is genuinely single-instance-only today.

## Database migrations

Migrations are not run inside the Docker build (the build stage has no database to connect to).
Run them as a separate step against the target database before starting new instances:

```bash
npx prisma migrate deploy
```

This is the production-safe counterpart to `prisma migrate dev` (which is dev-only - it can
reset the database) - it only applies migrations already committed under `prisma/migrations/`.

## Background jobs

There's no persistent worker process or job queue - `/api/cron/invoice-due-sweep`,
`/api/cron/low-stock-sweep`, `/api/cron/pending-payment-sweep`, and
`/api/cron/recurring-purchase-sweep` are plain authenticated routes (both `GET` and `POST` -
see below) meant to be triggered by an external scheduler once the app is running:

- **Vercel Cron** (`vercel.json`'s own `crons` config, included in this repository) if deploying
  to Vercel.
- A **GitHub Actions scheduled workflow** running
  `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/<job>`.
- **System crontab + curl** on a self-hosted box, same header as above.

**Phase 23 finding, fixed**: Vercel Cron has two calling-convention constraints neither
`vercel.json` nor Vercel's dashboard lets you override - it always sends a plain `GET` request
(never `POST`), and it can only ever add one specific header itself,
`Authorization: Bearer <CRON_SECRET>` (automatically, whenever a Vercel project environment
variable is literally named `CRON_SECRET` - there's no way to configure it to send
`x-cron-secret` instead). Before this phase, every cron route only exported `POST` and only
checked `x-cron-secret` - Vercel's own scheduled pings would have 405'd before even reaching
authentication. Each of the four routes now also exports `GET` (the identical handler, not a
duplicate - `export const GET = POST`), and `requireCronSecret` (`server/auth/require.ts`) accepts
either `x-cron-secret` or `Authorization: Bearer <CRON_SECRET>` - additively, so the existing
GitHub Actions/crontab convention keeps working unchanged. Verified locally (route-level tests,
`cron.routes.test.ts`) with both header shapes and both HTTP methods; **not yet observed as a real
scheduled Vercel Cron invocation**, since no Vercel project exists to schedule one in.

Point `invoice-due-sweep`, `low-stock-sweep`, and `recurring-purchase-sweep` at roughly an hourly
interval, and `pending-payment-sweep` (reconciles mobile money payments a webhook never confirmed)
every few minutes if any real mobile money gateway below is configured - it's a no-op otherwise
(see `vercel.json` for the exact schedules this repo declares). All four fail closed (401) until
`CRON_SECRET` is set - see `.env.example` for the exact routes and what each one does. Every one
of the four is independently idempotent (a conditional update keyed on the exact row state read,
or a dedupe window) - a missed run, an overlapping run, or the scheduler firing twice is always
safe; **status: IMPLEMENTED, EXTERNAL SCHEDULER REQUIRED** - nothing in this repository itself
invokes these routes on a schedule, and no scheduled invocation (Vercel Cron or otherwise) has
ever actually been observed firing against a real deployment.

## Health check

`GET /api/health` returns `{"status":"ok","checks":{"database":"ok"}}` (200) when the app can
reach its database - point your platform's health check / load balancer probe at it.
`GET /api/ready` is the equivalent readiness probe.

## Object storage

RFQ/purchase-request document uploads (`server/services/documents.service.ts`,
`POST /api/rfqs/[rfqId]/documents` etc. - Phase 20) work with zero configuration using
`LocalDiskStorageProvider`, which writes to a `.uploads/` directory on the running instance's own
disk. **This is fine for local development or a genuinely single-instance deployment, and
unsuitable for more than one instance** - each instance would only see the files uploaded to it,
not a shared set. Setting all four of `STORAGE_BUCKET`/`STORAGE_REGION`/`STORAGE_ACCESS_KEY_ID`/
`STORAGE_SECRET_ACCESS_KEY` (see `.env.example`) switches to `S3StorageProvider` - a real
S3-compatible client (`@aws-sdk/client-s3`) verified with the SDK's own commands mocked, never
against a real bucket (no credentials exist in this environment) - **status: IMPLEMENTED, REAL
PROVIDER NOT VERIFIED, REQUIRES INFRASTRUCTURE** before relying on it beyond development/
single-instance use.

## What's intentionally not here yet

- **Redis-backed rate limiting** - `src/server/auth/rate-limit.ts` is in-memory today, correct
  for a single instance. Needed only once this deploys as more than one instance behind a load
  balancer; the file already documents this as a deferred decision, not an oversight. No evidence
  anywhere in this repository's own configuration (no `docker-compose.yml`, no load-balancer
  config, no multi-instance references) indicates multi-instance deployment is currently planned.
- **A real MTN MoMo/Telecel Cash/AirtelTigo Money sandbox round-trip** - the gateway client
  (`server/services/payment/gateways/`) is implemented and adapter-tested with `fetch` mocked, but
  no real sandbox credentials exist in this repository or environment - **REQUIRES EXTERNAL
  CREDENTIALS**.
- **A verified Docker build** - the `Dockerfile` has been reviewed line by line (see
  `PHASE21_FINAL_REPORT.md`/`PHASE23_FINAL_REPORT.md`) but never actually built or run, because
  `docker` is not installed in any environment this project's work has had access to -
  **NOT VERIFIED**.
- **An actual Vercel deployment** - no Vercel account or project exists in this environment.
  `vercel.json`'s cron schedules and the `requireCronSecret`/route-method fixes above are real,
  tested code changes, but a real scheduled Vercel Cron invocation has never actually been
  observed - **NOT VERIFIED**.
