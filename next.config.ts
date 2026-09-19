import type { NextConfig } from "next";

// Applied to every response.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Only meaningful over HTTPS (which production deployment is) - harmless as a no-op over the
  // plain-HTTP dev server.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // CSP itself is NOT set here (Phase 17, section 4) - it needs a fresh nonce every request,
  // which a static next.config.ts header can't produce (the same value would ship on every
  // response, defeating the point of a nonce). See src/proxy.ts's `pageProxy`, which sets
  // either `Content-Security-Policy` or `Content-Security-Policy-Report-Only` per request
  // depending on the CSP_ENFORCED env var - and PHASE17_AUDIT.md finding 1/2 for why this moved
  // out of next.config.ts entirely rather than existing in both places.
];

const nextConfig: NextConfig = {
  // Deployment readiness: emits .next/standalone - a self-contained server bundle with only the
  // node_modules it actually needs traced in, instead of requiring the full node_modules tree
  // (and a separate `npm install --production`) inside the runtime image. See Dockerfile.
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
