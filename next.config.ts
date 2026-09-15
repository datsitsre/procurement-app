import type { NextConfig } from "next";

// Applied to every response. Deliberately not a CSP yet - this app only self-hosts fonts via
// next/font (no external script/style/frame sources anywhere in the codebase), but a CSP is
// high blast-radius if it's wrong, so it needs its own dedicated testing pass rather than being
// bundled in here untested.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // Only meaningful over HTTPS (which production deployment is) - harmless as a no-op over the
  // plain-HTTP dev server.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
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
