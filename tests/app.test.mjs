import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "email-service-test-"));
const dataDir = path.join(tempRoot, "data");
const dbPath = path.join(dataDir, "email_service.db");

process.env.NODE_ENV = "test";
process.env.DATA_DIR = dataDir;
process.env.DATABASE_PATH = dbPath;
process.env.BASE_URL = "http://127.0.0.1:3000";
process.env.API_SECRET = "test-secret";
process.env.DOUBLE_OPTIN = "false";
process.env.SUBSCRIBE_ALLOWED_ORIGINS = "http://allowed.test";
process.env.SUBSCRIBE_RATE_WINDOW_MINUTES = "60";
process.env.SUBSCRIBE_IP_WINDOW_MAX = "10";
process.env.SUBSCRIBE_EMAIL_WINDOW_MAX = "1";
process.env.COMPANY_NAME = "Test Company";
process.env.COMPANY_ADDRESS = "123 Test St";
process.env.FROM_EMAIL = "sender@example.com";
process.env.FROM_NAME = "Sender";
process.env.RESEND_API_KEY = "re_test";

await import("../dist/index.js");
const { getDb, closeDb } = await import("../dist/db/connection.js");
const { runMigrations } = await import("../dist/db/schema.js");
const {
  addSubscriber,
  countRemainingCampaignRecipients,
  findByEmail,
  getNextCampaignBatch,
} = await import("../dist/services/subscriberService.js");
const { createCampaign } = await import("../dist/services/campaignService.js");
const {
  createAdminSessionRecord,
  deleteAdminSessionToken,
  hasValidAdminSessionToken,
  registerRateLimitAttempt,
} = await import("../dist/services/runtimeStateService.js");

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

function resetDatabase() {
  closeDb();
  removeIfExists(dbPath);
  removeIfExists(`${dbPath}-wal`);
  removeIfExists(`${dbPath}-shm`);
  removeIfExists(dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  runMigrations();
}

test.beforeEach(() => {
  resetDatabase();
});

test.after(() => {
  closeDb();
  removeIfExists(tempRoot);
});

test("admin sessions persist in SQLite and can be revoked", () => {
  const session = createAdminSessionRecord(1);
  assert.equal(hasValidAdminSessionToken(session.token), true);

  closeDb();
  assert.equal(hasValidAdminSessionToken(session.token), true);

  deleteAdminSessionToken(session.token);
  assert.equal(hasValidAdminSessionToken(session.token), false);
});

test("subscribe rate limits survive DB reconnects", () => {
  const firstAttempt = registerRateLimitAttempt(
    "subscribe-email",
    "person@example.com",
    60 * 60 * 1000,
    1
  );
  assert.equal(firstAttempt.allowed, true);

  closeDb();

  const secondAttempt = registerRateLimitAttempt(
    "subscribe-email",
    "person@example.com",
    60 * 60 * 1000,
    1
  );
  assert.equal(secondAttempt.allowed, false);
  assert.ok(secondAttempt.retryAfterSeconds >= 1);
});

test("campaign recipient selection is deduplicated per campaign, not globally", () => {
  addSubscriber("alpha@example.com", "Alpha");
  addSubscriber("beta@example.com", "Beta");

  const campaignA = createCampaign({ name: "Campaign A" });
  const campaignB = createCampaign({ name: "Campaign B" });
  const db = getDb();
  const alpha = findByEmail("alpha@example.com");

  assert.ok(alpha);

  db.prepare(
    `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at, campaign_id, delivery_status)
     VALUES (?, ?, ?, 'sent', datetime('now'), ?, 'sent')`
  ).run("batch-a", alpha.id, "resend-1", campaignA.id);

  const remainingForA = getNextCampaignBatch(campaignA.id, 10).map(
    (subscriber) => subscriber.email
  );
  const remainingForB = getNextCampaignBatch(campaignB.id, 10).map(
    (subscriber) => subscriber.email
  );

  assert.deepEqual(remainingForA, ["beta@example.com"]);
  assert.deepEqual(remainingForB.sort(), ["alpha@example.com", "beta@example.com"]);
  assert.equal(countRemainingCampaignRecipients(campaignA.id), 1);
  assert.equal(countRemainingCampaignRecipients(campaignB.id), 2);
});
