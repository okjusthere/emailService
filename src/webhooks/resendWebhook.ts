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
      // Update send log status
      db.prepare(
        `UPDATE send_logs SET status = 'delivered' WHERE resend_email_id = ?`
      ).run(data.email_id);
      break;
    }

    case "email.bounced": {
      // Mark subscriber as bounced — never send to them again
      db.prepare(
        `UPDATE send_logs SET status = 'bounced' WHERE resend_email_id = ?`
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
        `UPDATE send_logs SET status = 'complained' WHERE resend_email_id = ?`
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
        `UPDATE send_logs SET status = 'opened' WHERE resend_email_id = ? AND status NOT IN ('bounced', 'complained')`
      ).run(data.email_id);
      break;
    }

    case "email.clicked": {
      db.prepare(
        `UPDATE send_logs SET status = 'clicked' WHERE resend_email_id = ? AND status NOT IN ('bounced', 'complained')`
      ).run(data.email_id);
      break;
    }

    default:
      logger.info(`Unhandled webhook event type: ${type}`);
  }
}
