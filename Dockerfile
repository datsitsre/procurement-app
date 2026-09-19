# Multi-stage build for the standalone Next.js output (next.config.ts sets output: 'standalone').
# Not verified inside this environment - `docker` is not installed here - so treat this as a
# reviewed-but-unverified starting point (see DEPLOYMENT.md) rather than a proven artifact.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Needed at build time only: `next build` runs `next typegen` and type-checks the app, and Prisma
# generates its client from schema.prisma - neither touches a real database connection.
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# The standalone output already traces in only the node_modules the server needs - no separate
# node_modules copy or `npm install --production` here.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000

# server.js is the standalone entrypoint Next.js generates - not `next start`, which expects the
# full (non-standalone) build output this image doesn't include.
CMD ["node", "server.js"]
