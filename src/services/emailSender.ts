import { Resend } from "resend";
import { randomUUID } from "crypto";
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

const resend = new Resend(config.resendApiKey);

interface EmailContent {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/**
 * Send a single batch of up to 100 emails via Resend Batch API
 */
async function sendBatch(
  subscribers: Subscriber[],
  content: EmailContent,
  batchId: string
): Promise<{ sent: number; failed: number }> {
  const db = getDb();

  const emails = subscribers.map((sub) => {
    const unsubscribeUrl = buildUnsubscribeUrl(sub.unsubscribe_token);
    const html = buildRecruitmentEmail({
      recipientName: sub.name || undefined,
      subject: content.subject,
      bodyHtml: content.bodyHtml,
      unsubscribeUrl,
    });
    const text = buildPlainText({
      recipientName: sub.name || undefined,
      bodyText: content.bodyText,
      unsubscribeUrl,
    });

    // Validate CAN-SPAM compliance on first email
    if (sub === subscribers[0]) {
      const check = validateCompliance(html);
      if (!check.valid) {
        logger.error("CAN-SPAM compliance check failed", check.issues);
        throw new Error(
          `CAN-SPAM compliance failed: ${check.issues.join(", ")}`
        );
      }
    }

    return {
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [sub.email],
      reply_to: config.replyToEmail,
      subject: content.subject,
      html,
      text,
      headers: getComplianceHeaders(unsubscribeUrl),
    };
  });

  try {
    const result = await resend.batch.send(emails);

    // Record send logs
    const insertLog = db.prepare(
      `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );

    const insertTx = db.transaction(() => {
      if (result.data) {
        const dataArr = result.data as unknown as { id: string }[];
        for (let i = 0; i < subscribers.length; i++) {
          const emailResult = dataArr[i];
          insertLog.run(
            batchId,
            subscribers[i].id,
            emailResult?.id || null,
            "sent"
          );
        }
      }
    });
    insertTx();

    markAsSent(subscribers.map((s) => s.id));

    const sentCount = (result.data as unknown as unknown[])?.length || 0;
    logger.info(
      `Batch sent: ${sentCount}/${subscribers.length} emails`
    );
    return { sent: sentCount, failed: subscribers.length - sentCount };
  } catch (err: any) {
    logger.error(`Batch send failed: ${err.message}`);

    // Record failures
    const insertFailLog = db.prepare(
      `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message)
       VALUES (?, ?, 'failed', ?)`
    );
    const failTx = db.transaction(() => {
      for (const sub of subscribers) {
        insertFailLog.run(batchId, sub.id, err.message);
      }
    });
    failTx();

    return { sent: 0, failed: subscribers.length };
  }
}

/**
 * Execute the daily email send.
 * Respects IP warmup limits if SEND_START_DATE is configured.
 */
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

  logger.info(
    `Starting daily send: ${subscribers.length} subscribers (limit: ${effectiveLimit}${warmup.isWarmingUp ? `, warmup day ${warmup.warmupDay}` : ""}), batch ID: ${batchId}`
  );

  // Create batch record
  db.prepare(
    `INSERT INTO batches (id, total_count, status, started_at) VALUES (?, ?, 'in_progress', datetime('now'))`
  ).run(batchId, subscribers.length);

  let totalSent = 0;
  let totalFailed = 0;

  // Split into chunks of batchSize (100)
  const chunks: Subscriber[][] = [];
  for (let i = 0; i < subscribers.length; i += config.batchSize) {
    chunks.push(subscribers.slice(i, i + config.batchSize));
  }

  // Process chunks with rate limiting (2 req/s to stay under 5 req/s limit)
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const result = await sendBatch(chunk, content, batchId);
    totalSent += result.sent;
    totalFailed += result.failed;

    // Rate limit: wait 500ms between batch calls (= 2 req/s)
    if (i < chunks.length - 1) {
      await sleep(500);
    }

    // Log progress every 10 chunks
    if ((i + 1) % 10 === 0) {
      logger.info(
        `Progress: ${i + 1}/${chunks.length} chunks processed (${totalSent} sent, ${totalFailed} failed)`
      );
    }
  }

  // Update batch record
  db.prepare(
    `UPDATE batches SET sent_count = ?, failed_count = ?, status = 'completed', completed_at = datetime('now') WHERE id = ?`
  ).run(totalSent, totalFailed, batchId);

  logger.success(
    `Daily send complete! Batch ${batchId}: ${totalSent} sent, ${totalFailed} failed`
  );

  return { batchId, totalSent, totalFailed };
}

/**
 * Send a single test email to a specific address
 */
export async function sendTestEmail(
  testEmail: string,
  content: EmailContent
): Promise<{ success: boolean; error?: string }> {
  const unsubscribeUrl = `${config.baseUrl}/unsubscribe?token=test-preview`;
  const html = buildRecruitmentEmail({
    recipientName: "Test Recipient",
    subject: content.subject,
    bodyHtml: content.bodyHtml,
    unsubscribeUrl,
  });
  const text = buildPlainText({
    recipientName: "Test Recipient",
    bodyText: content.bodyText,
    unsubscribeUrl,
  });

  try {
    await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [testEmail],
      replyTo: config.replyToEmail,
      subject: `[TEST] ${content.subject}`,
      html,
      text,
      headers: getComplianceHeaders(unsubscribeUrl),
    });
    logger.info(`Test email sent to: ${testEmail}`);
    return { success: true };
  } catch (err: any) {
    logger.error(`Test email failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

