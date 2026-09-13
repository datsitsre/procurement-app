import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Vitest/Vite don't load `.env` into `process.env` by default (only into `import.meta.env`,
// and only for VITE_-prefixed vars unless a third argument widens the prefix). Server-side
// modules under test (src/server/*) read `process.env` directly via server/env.ts, the same way
// they do when Next.js runs them - so tests need the same values Next itself gets from `.env`.
Object.assign(process.env, loadEnv('test', process.cwd(), ''));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` is a Next.js/webpack build-time guard (it inspects which bundler
      // "condition" resolved it) - outside Next's own build it always resolves to the
      // throwing stub, even in a plain Node test environment. Vitest doesn't do the
      // client/server module-graph analysis that guard exists for, so it's a no-op here.
      'server-only': path.resolve(__dirname, './src/server/__test-stubs__/server-only.ts'),
    },
  },
});
