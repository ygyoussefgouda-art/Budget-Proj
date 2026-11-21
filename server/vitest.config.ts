import { defineConfig } from 'vitest/config';

// Password hashing is deliberately slow (~1 s per hash on a small CPU), so tests that
// sign in many times need more than the default 5 seconds.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
