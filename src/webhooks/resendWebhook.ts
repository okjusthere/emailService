import { getDb } from "../db/connection.js";
import {
  updateSubscriberStatus,
} from "../services/subscriberService.js";
import { logger } from "../utils/logger.js";

interface ResendWebhookEvent {
  type: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    [key: string]: unknown;
  };
}

function extractWebhookMessage(data: ResendWebhookEvent["data"], key: string): string | null {
  const value = data[key];

  if (!value || typeof value !== "object") {
    return null;
  }

  const message = (value as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/**
 * Handle incoming webhook events from Resend.
 *
 * Events reference: https://resend.com/docs/dashboard/webhooks/event-types
 */
export function handleWebhookEvent(event: ResendWebhookEvent): void {
  const { type, data } = event;
  const db = getDb();

  logger.info(`Webhook event received: ${type}`, {
    email_id: data.email_id,
    to: data.to,
  });

  // Persist event to webhook_events table for audit trail
  try {
    db.prepare(
      `INSERT INTO webhook_events (event_type, resend_email_id, recipient, subject, payload)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      type,
      data.email_id || null,
      Array.isArray(data.to) ? data.to.join(", ") : data.to || null,
      data.subject || null,
      JSON.stringify(data)
    );
  } catch (err: any) {
    logger.error(`Failed to persist webhook event: ${err.message}`);
  }

  switch (type) {
    case "email.delivered": {
      db.prepare(
        `UPDATE send_logs
         SET delivery_status = CASE
               WHEN delivery_status IN ('bounced', 'complained') THEN delivery_status
               ELSE 'delivered'
             END,
             delivered_at = COALESCE(delivered_at, datetime('now'))
         WHERE resend_email_id = ?`
      ).run(data.email_id);
      break;
    }

    case "email.bounced": {
      // Mark subscriber as bounced — never send to them again
      db.prepare(
        `UPDATE send_logs
         SET delivery_status = 'bounced',
             bounced_at = COALESCE(bounced_at, datetime('now'))
         WHERE resend_email_id = ?`
      ).run(data.email_id);

      for (const email of data.to) {
        const updated = updateSubscriberStatus(email, "bounced");
        if (updated) {
          logger.warn(`Subscriber bounced and deactivated: ${email}`);
        }
      }
      break;
    }

    case "email.complained": {
      // Mark subscriber as complained — never send to them again (critical for CAN-SPAM)
      db.prepare(
        `UPDATE send_logs
         SET delivery_status = 'complained',
             complained_at = COALESCE(complained_at, datetime('now'))
         WHERE resend_email_id = ?`
      ).run(data.email_id);

      for (const email of data.to) {
        const updated = updateSubscriberStatus(email, "complained");
        if (updated) {
          logger.warn(`Subscriber complained and deactivated: ${email}`);
        }
      }
      break;
    }

    case "email.delivery_delayed": {
      db.prepare(
        `UPDATE send_logs
         SET delivery_status = CASE
               WHEN delivery_status IN ('delivered', 'bounced', 'complained', 'suppressed', 'failed') THEN delivery_status
               ELSE 'delayed'
             END,
             error_message = COALESCE(error_message, ?)
         WHERE resend_email_id = ?`
      ).run("Recipient mail server delayed delivery", data.email_id);
      break;
    }

    case "email.failed": {
      db.prepare(
        `UPDATE send_logs
         SET status = 'failed',
             delivery_status = 'failed',
             error_message = COALESCE(?, error_message, 'Resend reported final delivery failure')
         WHERE resend_email_id = ?`
      ).run(extractWebhookMessage(data, "failed"), data.email_id);
      break;
    }

    case "email.suppressed": {
      const message =
        extractWebhookMessage(data, "suppressed") ||
        "Resend suppressed this recipient because of prior bounce or complaint";

      db.prepare(
        `UPDATE send_logs
         SET status = 'failed',
             delivery_status = 'suppressed',
             error_message = COALESCE(?, error_message)
         WHERE resend_email_id = ?`
      ).run(message, data.email_id);

      for (const email of data.to) {
        const updated = updateSubscriberStatus(email, "suppressed");
        if (updated) {
          logger.warn(`Subscriber suppressed by Resend: ${email}`);
        }
      }
      break;
    }

    case "email.opened": {
      db.prepare(
        `UPDATE send_logs
         SET delivery_status = CASE
               WHEN delivery_status IN ('bounced', 'complained') THEN delivery_status
               ELSE COALESCE(NULLIF(delivery_status, ''), 'delivered')
             END,
             delivered_at = COALESCE(delivered_at, datetime('now')),
             opened_at = COALESCE(opened_at, datetime('now'))
         WHERE resend_email_id = ?`
      ).run(data.email_id);
      break;
    }

    case "email.clicked": {
      db.prepare(
        `UPDATE send_logs
         SET delivery_status = CASE
               WHEN delivery_status IN ('bounced', 'complained') THEN delivery_status
               ELSE COALESCE(NULLIF(delivery_status, ''), 'delivered')
             END,
             delivered_at = COALESCE(delivered_at, datetime('now')),
             opened_at = COALESCE(opened_at, datetime('now')),
             clicked_at = COALESCE(clicked_at, datetime('now'))
         WHERE resend_email_id = ?`
      ).run(data.email_id);
      break;
    }

    default:
      logger.info(`Unhandled webhook event type: ${type}`);
  }
}
