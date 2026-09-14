import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployment readiness: emits .next/standalone - a self-contained server bundle with only the
  // node_modules it actually needs traced in, instead of requiring the full node_modules tree
  // (and a separate `npm install --production`) inside the runtime image. See Dockerfile.
  output: 'standalone',
};

export default nextConfig;
