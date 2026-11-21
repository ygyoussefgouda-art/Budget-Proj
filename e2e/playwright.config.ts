import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, '..', 'server');
const PORT = 3100;

/**
 * End-to-end tests: a real browser drives the real app (built web app + API)
 * on a brand-new in-memory Postgres (PGlite), so every run starts empty.
 * Build the web app first: `cd web && npm run build`.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'Africa/Cairo',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node ${JSON.stringify(path.join(server, 'node_modules', 'tsx', 'dist', 'cli.mjs'))} src/index.ts`,
    cwd: server,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      DB_DRIVER: 'pglite', // in-memory database, empty on every run
      PGLITE_DIR: '',
      PUBLIC_DIR: path.join(here, '..', 'web', 'dist'),
      ALLOW_SIGNUP: 'true',
      // Built-in "owner" account (always an admin) for the admin-page tests. Test-only password.
      APP_PASSWORD: 'e2e-owner-pass-123',
      LOGIN_RATE_LIMIT: '1000',
      SIGNUP_RATE_LIMIT: '1000',
    },
  },
});
