import { defineConfig, devices } from "@playwright/test";

const appEnv = {
  NODE_ENV: "test",
  BASE_URL: "http://127.0.0.1:3000",
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://homix:homix@localhost:5434/homix_marketing?schema=public",
  DIRECT_DATABASE_URL:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://homix:homix@localhost:5434/homix_marketing?schema=public",
  AUTH_MODE: "local",
  LOCAL_ADMIN_EMAIL: "admin@homixny.com",
  SESSION_SECRET: "playwright-session-secret-at-least-sixteen-bytes",
  UNSUBSCRIBE_SIGNING_SECRET: "playwright-unsubscribe-secret-at-least-thirty-two-bytes",
  EMAIL_PROVIDER: "fake",
  EMAIL_DELIVERY_MODE: "sandbox",
  EMAIL_TEST_ALLOWLIST: "admin@homixny.com,e2e-recipient@homixny.com",
  STORAGE_PROVIDER: "local",
  LOCAL_ASSET_DIR: "./data/e2e-assets",
  PUBLIC_ASSET_BASE_URL: "http://127.0.0.1:3000/public/assets",
  COMPANY_NAME: "Homix Realty",
  COMPANY_POSTAL_ADDRESS: "123 Main Street, Huntington, NY 11743",
  COMPANY_WEBSITE: "https://homixny.com",
  WORKER_POLL_INTERVAL_MS: "250",
  ONEKEY_PROVIDER: "fake",
  AI_PROVIDER: "fake",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      'npx concurrently -k -s first "cross-env APP_ROLE=web node dist/server/src/bootstrap.js" "cross-env APP_ROLE=worker node dist/server/src/bootstrap.js"',
    env: appEnv,
    url: "http://127.0.0.1:3000/health/ready",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
