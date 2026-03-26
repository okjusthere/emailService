import { randomUUID } from "crypto";
import PQueue from "p-queue";
import { Resend, type Attachment } from "resend";
import { config } from "../config.js";
import { getDb } from "../db/connection.js";
import {
  countRemainingCampaignRecipients,
  getNextCampaignBatch,
  markAsSent,
  type Subscriber,
} from "./subscriberService.js";
import {
  buildRecruitmentEmail,
  buildPlainText,
  type TemplateMode,
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
import {
  normalizePlainText,
  normalizeSubject,
  sanitizeEmailHtml,
} from "../utils/emailHtml.js";

export interface EmailContent {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  templateMode?: TemplateMode;
}

let resendClient: Resend | null = null;

interface PreparedEmailContent extends EmailContent {
  attachments: Attachment[];
  usesEmbeddedAssets: boolean;
  resolvedBodyHtml: string;
}

interface BatchSendItem {
  id?: string;
}

interface BatchSendPayload {
  data?: BatchSendItem[];
  errors?: Array<{ index: number; message: string }>;
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
  const normalizedContent: EmailContent = {
    subject: normalizeSubject(content.subject),
    bodyHtml: sanitizeEmailHtml(content.bodyHtml),
    bodyText: normalizePlainText(content.bodyText),
    templateMode: content.templateMode,
  };

  if (!hasEmbeddedAssets(normalizedContent.bodyHtml)) {
    return {
      ...normalizedContent,
      attachments: [],
      usesEmbeddedAssets: false,
      resolvedBodyHtml: normalizedContent.bodyHtml,
    };
  }

  const resolved = resolveAssetPlaceholdersToInlineAttachments(
    normalizedContent.bodyHtml
  );

  if (resolved.missingAssetIds.length > 0) {
    throw new Error(
      `Missing embedded assets: ${resolved.missingAssetIds.join(", ")}`
    );
  }

  return {
    ...normalizedContent,
    attachments: resolved.attachments,
    usesEmbeddedAssets: true,
    resolvedBodyHtml: resolved.html,
  };
}

/**
 * Replace merge tags like {{name}}, {{email}} with subscriber-specific values.
 */
function replaceMergeTags(
  text: string,
  subscriber: Subscriber
): string {
  return text
    .replace(/\{\{name\}\}/gi, subscriber.name || "there")
    .replace(/\{\{email\}\}/gi, subscriber.email)
    .replace(/\{\{first_name\}\}/gi, (subscriber.name || "there").split(" ")[0]);
}

function buildSubscriberEmail(
  subscriber: Subscriber,
  content: PreparedEmailContent
): {
  attachments: Attachment[];
  headers: Record<string, string>;
  html: string;
  subject: string;
  text: string;
} {
  const unsubscribeUrl = buildUnsubscribeUrl(subscriber.unsubscribe_token);

  // Apply merge tags to body content
  const personalizedSubject = replaceMergeTags(content.subject, subscriber);
  const personalizedHtml = replaceMergeTags(content.resolvedBodyHtml, subscriber);
  const personalizedText = replaceMergeTags(content.bodyText, subscriber);

  const html = buildRecruitmentEmail({
    recipientName: subscriber.name || undefined,
    subject: personalizedSubject,
    bodyHtml: personalizedHtml,
    unsubscribeUrl,
    templateMode: content.templateMode,
  });
  const text = buildPlainText({
    recipientName: subscriber.name || undefined,
    bodyText: personalizedText,
    unsubscribeUrl,
  });

  return {
    attachments: content.attachments,
    headers: getComplianceHeaders(unsubscribeUrl),
    html,
    subject: personalizedSubject,
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

export function normalizeBatchSendPayload(payload: unknown): BatchSendPayload {
  if (Array.isArray(payload)) {
    return { data: payload as BatchSendItem[] };
  }

  if (payload && typeof payload === "object") {
    const objectPayload = payload as BatchSendPayload;
    return {
      data: Array.isArray(objectPayload.data) ? objectPayload.data : [],
      errors: Array.isArray(objectPayload.errors) ? objectPayload.errors : [],
    };
  }

  return { data: [], errors: [] };
}

async function sendBatchEmails(
  subscribers: Subscriber[],
  content: PreparedEmailContent,
  batchId: string,
  campaignId?: string
): Promise<{ failed: number; sent: number }> {
  const db = getDb();

  const emails = subscribers.map((subscriber) => {
    const rendered = buildSubscriberEmail(subscriber, content);
    return {
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [subscriber.email],
      replyTo: getReplyTo(),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: rendered.headers,
    };
  });

  assertCompliance(emails[0].html);

  try {
    const resend = getResendClient();
    const response = await resend.batch.send(emails);
    const batchPayload = normalizeBatchSendPayload(
      assertResendSuccess(response, "Batch send failed")
    );
    const data = batchPayload.data || [];
    const errorsByIndex = new Map(
      (batchPayload.errors || []).map((item) => [item.index, item.message])
    );

    const insertSuccessLog = db.prepare(
      `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at, campaign_id, delivery_status)
       VALUES (?, ?, ?, ?, datetime('now'), ?, 'sent')`
    );
    const insertFailureLog = db.prepare(
      `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message, campaign_id, delivery_status)
       VALUES (?, ?, 'failed', ?, ?, 'failed')`
    );
    const successfulSubscriberIds: number[] = [];

    db.transaction(() => {
      for (let index = 0; index < subscribers.length; index++) {
        const subscriber = subscribers[index];
        const emailResult = data[index];

        if (emailResult?.id) {
          successfulSubscriberIds.push(subscriber.id);
          insertSuccessLog.run(batchId, subscriber.id, emailResult.id, "sent", campaignId || null);
          continue;
        }

        insertFailureLog.run(
          batchId,
          subscriber.id,
          errorsByIndex.get(index) || "Resend batch API did not return an email id",
          campaignId || null
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
      `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message, campaign_id, delivery_status)
       VALUES (?, ?, 'failed', ?, ?, 'failed')`
    );

    db.transaction(() => {
      for (const subscriber of subscribers) {
        insertFailureLog.run(batchId, subscriber.id, error.message, campaignId || null);
      }
    })();

    return { sent: 0, failed: subscribers.length };
  }
}

async function sendInlineEmails(
  subscribers: Subscriber[],
  content: PreparedEmailContent,
  batchId: string,
  campaignId?: string
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
            subject: rendered.subject,
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
            `INSERT INTO send_logs (batch_id, subscriber_id, resend_email_id, status, sent_at, campaign_id, delivery_status)
             VALUES (?, ?, ?, ?, datetime('now'), ?, 'sent')`
          ).run(batchId, subscriber.id, data.id, "sent", campaignId || null);

          markAsSent([subscriber.id]);
          sent += 1;
        } catch (error: any) {
          db.prepare(
            `INSERT INTO send_logs (batch_id, subscriber_id, status, error_message, campaign_id, delivery_status)
             VALUES (?, ?, 'failed', ?, ?, 'failed')`
          ).run(batchId, subscriber.id, error.message, campaignId || null);

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
  batchId: string,
  campaignId?: string
): Promise<{ failed: number; sent: number }> {
  if (content.usesEmbeddedAssets) {
    return sendInlineEmails(subscribers, content, batchId, campaignId);
  }

  return sendBatchEmails(subscribers, content, batchId, campaignId);
}


/**
 * Send a single chunk of a campaign (for drip sending).
 * Returns the number of remaining unsent subscribers so the caller knows
 * whether to schedule another chunk.
 */
export async function sendCampaignChunk(
  content: EmailContent,
  campaignId: string,
  chunkSize: number,
  tagIds?: number[]
): Promise<{
  batchId: string;
  sent: number;
  failed: number;
  remaining: number;
}> {
  const db = getDb();
  const subscribers = getNextCampaignBatch(campaignId, chunkSize, tagIds);

  if (subscribers.length === 0) {
    return { batchId: "", sent: 0, failed: 0, remaining: 0 };
  }

  const batchId = randomUUID();
  const preparedContent = prepareEmailContent(content);

  logger.info(
    `Drip chunk: sending ${subscribers.length} emails (campaign ${campaignId}), batch ${batchId}`
  );

  db.prepare(
    `INSERT INTO batches (id, total_count, status, started_at, campaign_id) VALUES (?, ?, 'in_progress', datetime('now'), ?)`
  ).run(batchId, subscribers.length, campaignId);

  try {
    const result = await sendChunk(subscribers, preparedContent, batchId, campaignId);

    db.prepare(
      `UPDATE batches SET sent_count = ?, failed_count = ?, status = 'completed', completed_at = datetime('now') WHERE id = ?`
    ).run(result.sent, result.failed, batchId);

    const actualRemaining = countRemainingCampaignRecipients(campaignId, tagIds);

    return {
      batchId,
      sent: result.sent,
      failed: result.failed,
      remaining: actualRemaining,
    };
  } catch (error) {
    db.prepare(
      `UPDATE batches SET sent_count = 0, failed_count = ?, status = 'failed', completed_at = datetime('now') WHERE id = ?`
    ).run(subscribers.length, batchId);
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
      subject: `[TEST] ${rendered.subject}`,
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
