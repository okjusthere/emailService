import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { handleWebhookEvent } from "../webhooks/resendWebhook.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * Verify Resend webhook signature using Svix.
 * Resend uses Svix for webhook delivery and signing.
 *
 * Signature format: webhook-id, webhook-timestamp, webhook-signature headers
 * https://docs.svix.com/receiving/verifying-payloads/how
 */
function verifyWebhookSignature(req: Request, rawBody: string): boolean {
  const secret = config.resendWebhookSecret;
  if (!secret) {
    const allowInsecure = config.nodeEnv !== "production";
    if (allowInsecure) {
      logger.warn("RESEND_WEBHOOK_SECRET not configured — skipping verification in non-production mode");
      return true;
    }

    logger.error("RESEND_WEBHOOK_SECRET not configured in production");
    return false;
  }

  const webhookId = req.headers["svix-id"] as string;
  const webhookTimestamp = req.headers["svix-timestamp"] as string;
  const webhookSignature = req.headers["svix-signature"] as string;

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    logger.warn("Missing webhook signature headers");
    return false;
  }

  // Check timestamp is within 5 minutes to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(webhookTimestamp, 10);
  if (Math.abs(now - ts) > 300) {
    logger.warn("Webhook timestamp too old or in the future");
    return false;
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

  // Secret is base64-encoded with "whsec_" prefix
  const secretBytes = Buffer.from(secret.replace("whsec_", ""), "base64");
  const expectedSignature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest();

  // Signature header can contain multiple signatures separated by space
  const signatures = webhookSignature.split(/\s+/);
  for (const sig of signatures) {
    const sigValue = sig.split(",")[1]; // Format: "v1,base64signature"
    if (!sigValue) {
      continue;
    }

    const candidate = Buffer.from(sigValue, "base64");
    if (
      candidate.length === expectedSignature.length &&
      crypto.timingSafeEqual(candidate, expectedSignature)
    ) {
      return true;
    }
  }

  logger.warn("Webhook signature verification failed");
  return false;
}

/**
 * POST /webhook/resend
 *
 * Receives webhook events from Resend.
 * Configure this endpoint in your Resend dashboard:
 *   Settings → Webhooks → Add Endpoint → https://yourdomain.com/webhook/resend
 */
router.post("/resend", (req: Request, res: Response) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

  try {
    // Verify webhook signature
    if (!verifyWebhookSignature(req, rawBody)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    if (!rawBody) {
      res.status(400).json({ error: "Missing webhook payload" });
      return;
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ error: "Invalid webhook payload" });
      return;
    }

    if (!event || !event.type) {
      res.status(400).json({ error: "Invalid webhook payload" });
      return;
    }

    handleWebhookEvent(event);
    res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error(`Webhook processing error: ${err.message}`);
    res.status(500).json({ received: false, error: err.message });
  }
});

export default router;
