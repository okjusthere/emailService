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
  buildRecruitmentEmail,
  getDefaultTemplateMode,
} = await import("../dist/templates/recruitmentEmail.js");
const {
  normalizeBatchSendPayload,
} = await import("../dist/services/emailSender.js");
const {
  createEmailAsset,
  resolveAssetPlaceholdersToInlineAttachments,
} = await import("../dist/services/emailAssetService.js");
const {
  logger,
  logFilePath,
} = await import("../dist/utils/logger.js");
const {
  sanitizeEmailHtml,
} = await import("../dist/utils/emailHtml.js");
const {
  handleWebhookEvent,
} = await import("../dist/webhooks/resendWebhook.js");
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

test("failed campaign recipients are not repeatedly selected in later chunks", () => {
  addSubscriber("failed@example.com", "Failed");
  addSubscriber("next@example.com", "Next");

  const campaign = createCampaign({ name: "Failure dedupe" });
  const db = getDb();
  const failed = findByEmail("failed@example.com");

  assert.ok(failed);

  db.prepare(
    `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message, campaign_id, delivery_status)
     VALUES (?, ?, 'failed', 'Transient API error', ?, 'failed')`
  ).run("batch-failed", failed.id, campaign.id);

  const remaining = getNextCampaignBatch(campaign.id, 10).map(
    (subscriber) => subscriber.email
  );

  assert.deepEqual(remaining, ["next@example.com"]);
  assert.equal(countRemainingCampaignRecipients(campaign.id), 1);
});

test("campaigns persist template mode and duplicates keep it", async () => {
  const { duplicateCampaign, getCampaign } = await import(
    "../dist/services/campaignService.js"
  );

  const campaign = createCampaign({
    name: "Styled campaign",
    template_mode: "branded",
  });
  const duplicate = duplicateCampaign(campaign.id);

  assert.equal(getCampaign(campaign.id)?.template_mode, "branded");
  assert.equal(duplicate?.template_mode, "branded");
});

test("email builder supports explicit branded template overrides", () => {
  assert.equal(getDefaultTemplateMode(), "personal");

  const html = buildRecruitmentEmail({
    recipientName: "Alex",
    subject: "Theme preview",
    bodyHtml: "<p>Hello</p>",
    unsubscribeUrl: "http://127.0.0.1:3000/unsubscribe",
    templateMode: "branded",
  });

  assert.match(html, /Test Company/);
  assert.match(html, /class="header"/);
});

test("batch send payload normalization reads Resend batch responses correctly", () => {
  const modernPayload = normalizeBatchSendPayload({
    data: [{ id: "email-1" }, { id: "email-2" }],
  });
  const legacyPayload = normalizeBatchSendPayload([{ id: "email-3" }]);

  assert.deepEqual(modernPayload.data, [{ id: "email-1" }, { id: "email-2" }]);
  assert.deepEqual(legacyPayload.data, [{ id: "email-3" }]);
});

test("inline email assets resolve to cid attachments with base64 content", () => {
  const imageBuffer = Buffer.from("fake-image-content");
  const asset = createEmailAsset({
    buffer: imageBuffer,
    originalName: "banner.png",
    mimeType: "image/png",
    size: imageBuffer.length,
    baseUrl: "http://127.0.0.1:3000",
  });

  const resolved = resolveAssetPlaceholdersToInlineAttachments(
    `<p>Hello</p><img src="${asset.placeholder}" alt="Banner">`
  );

  assert.equal(resolved.missingAssetIds.length, 0);
  assert.equal(resolved.attachments.length, 1);
  assert.match(resolved.html, new RegExp(`cid:asset-${asset.id}@email-service`));
  assert.equal(
    resolved.attachments[0].content,
    imageBuffer.toString("base64")
  );
  assert.equal(resolved.attachments[0].contentId, `asset-${asset.id}@email-service`);
  assert.equal(resolved.attachments[0].contentType, "image/png");
});

test("asset images are normalized to an email-safe responsive width", () => {
  const html = sanitizeEmailHtml(
    '<p><img src="{{asset:abc-123}}" alt="Banner" style="max-width:100%;height:auto;border-radius:12px;"></p>'
  );

  assert.match(html, /width="560"/);
  assert.match(html, /width:100%/);
  assert.match(html, /max-width:560px/);
  assert.match(html, /height:auto/);
  assert.match(html, /display:block/);
});

test("webhook suppression and delayed events update delivery state", () => {
  addSubscriber("suppressed@example.com", "Suppressed");
  addSubscriber("delayed@example.com", "Delayed");

  const db = getDb();
  const suppressed = findByEmail("suppressed@example.com");
  const delayed = findByEmail("delayed@example.com");

  assert.ok(suppressed);
  assert.ok(delayed);

  db.prepare(
    `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at, campaign_id, delivery_status)
     VALUES (?, ?, ?, 'sent', datetime('now'), ?, 'sent')`
  ).run("batch-webhook", suppressed.id, "email-suppressed", "campaign-webhook");
  db.prepare(
    `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at, campaign_id, delivery_status)
     VALUES (?, ?, ?, 'sent', datetime('now'), ?, 'sent')`
  ).run("batch-webhook", delayed.id, "email-delayed", "campaign-webhook");

  handleWebhookEvent({
    type: "email.suppressed",
    data: {
      email_id: "email-suppressed",
      from: "sender@example.com",
      to: ["suppressed@example.com"],
      subject: "Suppressed",
      created_at: new Date().toISOString(),
      suppressed: { message: "On account suppression list" },
    },
  });
  handleWebhookEvent({
    type: "email.delivery_delayed",
    data: {
      email_id: "email-delayed",
      from: "sender@example.com",
      to: ["delayed@example.com"],
      subject: "Delayed",
      created_at: new Date().toISOString(),
    },
  });

  const suppressedLog = db
    .prepare("SELECT status, delivery_status, error_message FROM send_logs WHERE resend_email_id = ?")
    .get("email-suppressed");
  const delayedLog = db
    .prepare("SELECT status, delivery_status, error_message FROM send_logs WHERE resend_email_id = ?")
    .get("email-delayed");

  assert.equal(findByEmail("suppressed@example.com")?.status, "suppressed");
  assert.equal(suppressedLog.status, "failed");
  assert.equal(suppressedLog.delivery_status, "suppressed");
  assert.match(suppressedLog.error_message, /suppression/i);
  assert.equal(delayedLog.status, "sent");
  assert.equal(delayedLog.delivery_status, "delayed");
});

test("logger survives broken stderr pipes by falling back to a log file", () => {
  const originalWrite = process.stderr.write.bind(process.stderr);
  let intercepted = 0;

  process.stderr.write = (() => {
    intercepted += 1;
    const error = new Error("broken pipe");
    error.code = "EPIPE";
    throw error;
  });

  try {
    assert.doesNotThrow(() => {
      logger.error("Broken stderr test", { intercepted });
      logger.error("Broken stderr retry", { intercepted });
    });
  } finally {
    process.stderr.write = originalWrite;
  }

  const contents = fs.readFileSync(logFilePath, "utf8");
  assert.match(contents, /Broken stderr test/);
  assert.match(contents, /Broken stderr retry/);
});
