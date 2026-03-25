import { randomUUID } from "crypto";
import PQueue from "p-queue";
import { Resend, type Attachment } from "resend";
import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import {
  getNextBatch,
  markAsSent,
  type Subscriber,
} from "./subscriberService.js";
import {
  buildRecruitmentEmail,
  buildPlainText,
} from "../templates/recruitmentEmail.js";
import {
  getComplianceHeaders,
  buildUnsubscribeUrl,
  validateCompliance,
} from "../utils/compliance.js";
import { logger } from "../utils/logger.js";
import {
  hasEmbeddedAssets,
  resolveAssetPlaceholdersToInlineAttachments,
} from "./emailAssetService.js";
import { type EmailContent } from "./emailContentService.js";

let resendClient: Resend | null = null;

interface PreparedEmailContent extends EmailContent {
  attachments: Attachment[];
  usesEmbeddedAssets: boolean;
  resolvedBodyHtml: string;
}

function getResendClient(): Resend {
  if (!config.resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  if (!resendClient) {
    resendClient = new Resend(config.resendApiKey);
  }

  return resendClient;
}

function getReplyTo(): string | undefined {
  return config.replyToEmail || undefined;
}

function prepareEmailContent(content: EmailContent): PreparedEmailContent {
  if (!hasEmbeddedAssets(content.bodyHtml)) {
    return {
      ...content,
      attachments: [],
      usesEmbeddedAssets: false,
      resolvedBodyHtml: content.bodyHtml,
    };
  }

  const resolved = resolveAssetPlaceholdersToInlineAttachments(content.bodyHtml);

  if (resolved.missingAssetIds.length > 0) {
    throw new Error(
      `Missing embedded assets: ${resolved.missingAssetIds.join(", ")}`
    );
  }

  return {
    ...content,
    attachments: resolved.attachments,
    usesEmbeddedAssets: true,
    resolvedBodyHtml: resolved.html,
  };
}

function buildSubscriberEmail(
  subscriber: Subscriber,
  content: PreparedEmailContent
): {
  attachments: Attachment[];
  headers: Record<string, string>;
  html: string;
  text: string;
} {
  const unsubscribeUrl = buildUnsubscribeUrl(subscriber.unsubscribe_token);
  const html = buildRecruitmentEmail({
    recipientName: subscriber.name || undefined,
    subject: content.subject,
    bodyHtml: content.resolvedBodyHtml,
    unsubscribeUrl,
  });
  const text = buildPlainText({
    recipientName: subscriber.name || undefined,
    bodyText: content.bodyText,
    unsubscribeUrl,
  });

  return {
    attachments: content.attachments,
    headers: getComplianceHeaders(unsubscribeUrl),
    html,
    text,
  };
}

function assertCompliance(html: string): void {
  const check = validateCompliance(html);

  if (!check.valid) {
    logger.error("CAN-SPAM compliance check failed", check.issues);
    throw new Error(`CAN-SPAM compliance failed: ${check.issues.join(", ")}`);
  }
}

function assertResendSuccess(
  response: { data: any; error: any },
  fallbackMessage: string
): any {
  if (response.error) {
    throw new Error(response.error.message || fallbackMessage);
  }

  if (!response.data) {
    throw new Error(fallbackMessage);
  }

  return response.data;
}

async function sendBatchEmails(
  subscribers: Subscriber[],
  content: PreparedEmailContent,
  batchId: string
): Promise<{ failed: number; sent: number }> {
  const db = getDb();

  const emails = subscribers.map((subscriber) => {
    const rendered = buildSubscriberEmail(subscriber, content);
    return {
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [subscriber.email],
      reply_to: getReplyTo(),
      subject: content.subject,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
    };
  });

  assertCompliance(emails[0].html);

  try {
    const resend = getResendClient();
    const response = await resend.batch.send(emails);
    const data = assertResendSuccess(response, "Batch send failed") as {
      id?: string;
    }[];

    const insertSuccessLog = db.prepare(
      `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );
    const insertFailureLog = db.prepare(
      `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message)
       VALUES (?, ?, 'failed', ?)`
    );
    const successfulSubscriberIds: number[] = [];

    db.transaction(() => {
      for (let index = 0; index < subscribers.length; index++) {
        const subscriber = subscribers[index];
        const emailResult = data[index];

        if (emailResult?.id) {
          successfulSubscriberIds.push(subscriber.id);
          insertSuccessLog.run(batchId, subscriber.id, emailResult.id, "sent");
          continue;
        }

        insertFailureLog.run(
          batchId,
          subscriber.id,
          "Resend batch API did not return an email id"
        );
      }
    })();

    if (successfulSubscriberIds.length > 0) {
      markAsSent(successfulSubscriberIds);
    }

    const sent = successfulSubscriberIds.length;
    const failed = subscribers.length - sent;
    logger.info(`Batch sent: ${sent}/${subscribers.length} emails`);
    return { sent, failed };
  } catch (error: any) {
    logger.error(`Batch send failed: ${error.message}`);

    const insertFailureLog = db.prepare(
      `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message)
       VALUES (?, ?, 'failed', ?)`
    );

    db.transaction(() => {
      for (const subscriber of subscribers) {
        insertFailureLog.run(batchId, subscriber.id, error.message);
      }
    })();

    return { sent: 0, failed: subscribers.length };
  }
}

async function sendInlineEmails(
  subscribers: Subscriber[],
  content: PreparedEmailContent,
  batchId: string
): Promise<{ failed: number; sent: number }> {
  const db = getDb();
  const resend = getResendClient();
  const queue = new PQueue({
    concurrency: 2,
    interval: 1000,
    intervalCap: 2,
  });

  let sent = 0;
  let failed = 0;

  const firstEmail = buildSubscriberEmail(subscribers[0], content);
  assertCompliance(firstEmail.html);

  logger.info(
    `Embedded assets detected; using throttled single-send mode for ${subscribers.length} recipients`
  );

  await Promise.all(
    subscribers.map((subscriber) =>
      queue.add(async () => {
        const rendered = buildSubscriberEmail(subscriber, content);

        try {
          const response = await resend.emails.send({
            attachments: rendered.attachments,
            from: `${config.fromName} <${config.fromEmail}>`,
            to: [subscriber.email],
            replyTo: getReplyTo(),
            subject: content.subject,
            html: rendered.html,
            text: rendered.text,
            headers: rendered.headers,
          });
          const data = assertResendSuccess(
            response,
            `Inline send failed for ${subscriber.email}`
          ) as { id?: string };

          if (!data.id) {
            throw new Error("Resend did not return an email id");
          }

          db.prepare(
            `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
          ).run(batchId, subscriber.id, data.id, "sent");

          markAsSent([subscriber.id]);
          sent += 1;
        } catch (error: any) {
          db.prepare(
            `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message)
             VALUES (?, ?, 'failed', ?)`
          ).run(batchId, subscriber.id, error.message);

          failed += 1;
          logger.error(`Inline send failed for ${subscriber.email}: ${error.message}`);
        }
      })
    )
  );

  logger.info(`Inline send complete: ${sent}/${subscribers.length} emails`);
  return { sent, failed };
}

async function sendChunk(
  subscribers: Subscriber[],
  content: PreparedEmailContent,
  batchId: string
): Promise<{ failed: number; sent: number }> {
  if (content.usesEmbeddedAssets) {
    return sendInlineEmails(subscribers, content, batchId);
  }

  return sendBatchEmails(subscribers, content, batchId);
}

export async function executeDailySend(content: EmailContent): Promise<{
  batchId: string;
  totalSent: number;
  totalFailed: number;
}> {
  const { getEffectiveDailyLimit } = await import("../utils/warmup.js");
  const warmup = getEffectiveDailyLimit();
  const effectiveLimit = Math.min(warmup.limit, config.dailySendCount);

  const batchId = randomUUID();
  const db = getDb();
  const subscribers = getNextBatch(effectiveLimit);

  if (subscribers.length === 0) {
    logger.warn("No active subscribers to send to (all sent today or none active)");
    return { batchId, totalSent: 0, totalFailed: 0 };
  }

  const preparedContent = prepareEmailContent(content);

  logger.info(
    `Starting daily send: ${subscribers.length} subscribers (limit: ${effectiveLimit}${warmup.isWarmingUp ? `, warmup day ${warmup.warmupDay}` : ""}), batch ID: ${batchId}`
  );

  db.prepare(
    `INSERT INTO batches (id, total_count, status, started_at) VALUES (?, ?, 'in_progress', datetime('now'))`
  ).run(batchId, subscribers.length);

  let totalSent = 0;
  let totalFailed = 0;
  const chunks: Subscriber[][] = [];

  for (let index = 0; index < subscribers.length; index += config.batchSize) {
    chunks.push(subscribers.slice(index, index + config.batchSize));
  }

  try {
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const result = await sendChunk(chunk, preparedContent, batchId);
      totalSent += result.sent;
      totalFailed += result.failed;

      if (index < chunks.length - 1) {
        await sleep(preparedContent.usesEmbeddedAssets ? 1000 : 500);
      }

      if ((index + 1) % 10 === 0) {
        logger.info(
          `Progress: ${index + 1}/${chunks.length} chunks processed (${totalSent} sent, ${totalFailed} failed)`
        );
      }
    }

    db.prepare(
      `UPDATE batches SET sent_count = ?, failed_count = ?, status = 'completed', completed_at = datetime('now') WHERE id = ?`
    ).run(totalSent, totalFailed, batchId);

    logger.success(
      `Daily send complete! Batch ${batchId}: ${totalSent} sent, ${totalFailed} failed`
    );

    return { batchId, totalSent, totalFailed };
  } catch (error) {
    const remaining = Math.max(
      subscribers.length - totalSent - totalFailed,
      0
    );
    totalFailed += remaining;

    db.prepare(
      `UPDATE batches SET sent_count = ?, failed_count = ?, status = 'failed', completed_at = datetime('now') WHERE id = ?`
    ).run(totalSent, totalFailed, batchId);

    throw error;
  }
}

export async function sendTestEmail(
  testEmail: string,
  content: EmailContent
): Promise<{ error?: string; success: boolean }> {
  try {
    const preparedContent = prepareEmailContent(content);
    const previewSubscriber = {
      email: testEmail,
      id: 0,
      name: "Test Recipient",
      status: "active",
      unsubscribe_token: "test-preview",
      created_at: "",
      last_sent_at: null,
      send_count: 0,
      updated_at: "",
    } as Subscriber;
    const rendered = buildSubscriberEmail(previewSubscriber, preparedContent);

    assertCompliance(rendered.html);

    const resend = getResendClient();
    const response = await resend.emails.send({
      attachments: rendered.attachments,
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [testEmail],
      replyTo: getReplyTo(),
      subject: `[TEST] ${content.subject}`,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
    });

    assertResendSuccess(response, `Test email failed for ${testEmail}`);
    logger.info(`Test email sent to: ${testEmail}`);
    return { success: true };
  } catch (error: any) {
    logger.error(`Test email failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
