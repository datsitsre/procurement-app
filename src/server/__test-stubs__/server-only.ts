// Test-only stub for the `server-only` package (see vitest.config.ts's alias). The real package
// throws unless resolved through Next.js's bundler-specific "server" condition; vitest has no
// such condition, so without this alias every server-only module would fail to import in tests
// even when the test itself is correctly exercising server-only code. Intentionally empty.
export {};
