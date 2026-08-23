import { defineConfig } from "vitest/config";

const testEnv = {
  NODE_ENV: "test",
  APP_ROLE: "web",
  BASE_URL: "http://localhost:3000",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://homix:homix@localhost:5434/homix_marketing?schema=public",
  DIRECT_DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://homix:homix@localhost:5434/homix_marketing?schema=public",
  AUTH_MODE: "local",
  LOCAL_ADMIN_EMAIL: "admin@homixny.com",
  SESSION_SECRET: "test-session-secret-at-least-sixteen-bytes",
  EMAIL_PROVIDER: "fake",
  EMAIL_DELIVERY_MODE: process.env.TEST_DELIVERY_MODE ?? "disabled",
  EMAIL_TEST_ALLOWLIST: "admin@homixny.com",
  STORAGE_PROVIDER: "local",
  LOCAL_ASSET_DIR: "./data/test-assets",
  PUBLIC_ASSET_BASE_URL: "http://localhost:3000/public/assets",
  COMPANY_POSTAL_ADDRESS: "123 Main Street, Huntington, NY 11743",
  UNSUBSCRIBE_SIGNING_SECRET: "test-unsubscribe-secret-at-least-thirty-two-bytes",
  ONEKEY_PROVIDER: "fake",
  AI_PROVIDER: "fake",
};

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    env: testEnv,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/unit",
      include: [
        "src/config/env.ts",
        "src/email/compliance.ts",
        "src/email/providers/FakeEmailProvider.ts",
        "src/modules/audiences/domain.ts",
        "src/modules/campaigns/stateMachine.ts",
        "src/modules/delivery/quota.ts",
        "src/modules/delivery/retry.ts",
        "src/modules/suppressions/domain.ts",
        "src/shared/normalize.ts",
      ],
      thresholds: { branches: 80, perFile: true },
    },
  },
});
