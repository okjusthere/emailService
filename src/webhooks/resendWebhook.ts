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
