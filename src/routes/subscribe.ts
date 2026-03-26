import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { getDb } from "../db/connection.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * POST /api/subscribe — Public subscription endpoint
 * Accepts: { email, name? }
 * If doubleOptIn is enabled: creates with status 'pending', sends confirmation email
 * If doubleOptIn is disabled: creates with status 'active' immediately
 */
router.post("/", async (req: Request, res: Response) => {
  const { email, name } = req.body || {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  // Check if already subscribed
  const existing = db.prepare("SELECT id, status, confirmation_token FROM subscribers WHERE email = ?").get(normalizedEmail) as any;

  if (existing) {
    if (existing.status === "active") {
      res.json({ success: true, message: "You're already subscribed!" });
      return;
    }
    if (existing.status === "pending" && config.doubleOptIn) {
      // Resend confirmation
      await sendConfirmationEmail(normalizedEmail, existing.confirmation_token);
      res.json({ success: true, message: "Confirmation email resent. Please check your inbox." });
      return;
    }
    if (existing.status === "unsubscribed") {
      // Resubscribe
      if (config.doubleOptIn) {
        const token = randomUUID();
        db.prepare(
          `UPDATE subscribers SET status = 'pending', confirmation_token = ?, name = COALESCE(?, name), updated_at = datetime('now') WHERE id = ?`
        ).run(token, name || null, existing.id);
        await sendConfirmationEmail(normalizedEmail, token);
        res.json({ success: true, message: "Confirmation email sent. Please check your inbox." });
      } else {
        db.prepare(
          `UPDATE subscribers SET status = 'active', name = COALESCE(?, name), confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(name || null, existing.id);
        res.json({ success: true, message: "You're subscribed!" });
      }
      return;
    }
  }

  // New subscriber
  const unsubscribeToken = randomUUID();

  if (config.doubleOptIn) {
    const confirmToken = randomUUID();
    db.prepare(
      `INSERT INTO subscribers (email, name, status, unsubscribe_token, confirmation_token) VALUES (?, ?, 'pending', ?, ?)`
    ).run(normalizedEmail, name || null, unsubscribeToken, confirmToken);
    await sendConfirmationEmail(normalizedEmail, confirmToken);
    logger.info(`New subscriber (pending): ${normalizedEmail}`);
    res.json({ success: true, message: "Confirmation email sent. Please check your inbox." });
  } else {
    db.prepare(
      `INSERT INTO subscribers (email, name, status, unsubscribe_token, confirmed_at) VALUES (?, ?, 'active', ?, datetime('now'))`
    ).run(normalizedEmail, name || null, unsubscribeToken);
    logger.info(`New subscriber (active): ${normalizedEmail}`);
    res.json({ success: true, message: "You're subscribed!" });
  }
});

/**
 * GET /api/subscribe/confirm?token=xxx — Confirm email subscription
 */
router.get("/confirm", (req: Request, res: Response) => {
  const token = req.query.token as string;

  if (!token) {
    res.status(400).send(confirmPage("Invalid Link", "This confirmation link is not valid.", false));
    return;
  }

  const db = getDb();
  const subscriber = db.prepare(
    "SELECT id, email, status FROM subscribers WHERE confirmation_token = ?"
  ).get(token) as any;

  if (!subscriber) {
    res.send(confirmPage("Link Expired", "This confirmation link has already been used or is invalid.", false));
    return;
  }

  if (subscriber.status === "active") {
    res.send(confirmPage("Already Confirmed", "Your email is already confirmed. You're all set!", true));
    return;
  }

  db.prepare(
    `UPDATE subscribers SET status = 'active', confirmation_token = NULL, confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(subscriber.id);

  logger.info(`Subscriber confirmed: ${subscriber.email}`);
  res.send(confirmPage("Subscription Confirmed!", "Thank you for confirming your email. You'll start receiving our updates.", true));
});

/**
 * Send a confirmation email with a link to verify the subscription.
 */
async function sendConfirmationEmail(email: string, token: string): Promise<void> {
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(config.resendApiKey);
    const confirmUrl = `${config.baseUrl}/api/subscribe/confirm?token=${token}`;

    await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [email],
      subject: "Please confirm your subscription",
      html: confirmEmailHtml(confirmUrl),
      text: `Please confirm your subscription by visiting this link: ${confirmUrl}`,
    });

    logger.info(`Confirmation email sent to ${email}`);
  } catch (err: any) {
    logger.error(`Failed to send confirmation email to ${email}: ${err.message}`);
  }
}

/**
 * Confirmation email HTML template.
 */
function confirmEmailHtml(confirmUrl: string): string {
  const brandName = config.company.name || config.fromName || "Our Newsletter";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:#111827;padding:32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">${brandName}</h1>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#111827;font-size:18px;">Confirm your email</h2>
      <p style="color:#4b5563;line-height:1.6;margin:0 0 24px;">
        Thanks for subscribing! Please click the button below to confirm your email address.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${confirmUrl}" style="display:inline-block;padding:14px 32px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">
          Confirm Subscription
        </a>
      </div>
      <p style="color:#9ca3af;font-size:13px;line-height:1.5;margin:0;">
        If you didn't subscribe, you can safely ignore this email.
      </p>
    </div>
  </div>
</body></html>`;
}

/**
 * Confirmation result page HTML.
 */
function confirmPage(title: string, message: string, success: boolean): string {
  const icon = success ? "✅" : "⚠️";
  const color = success ? "#059669" : "#d97706";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;display:flex;justify-content:center;align-items:center;min-height:100vh;">
  <div style="max-width:400px;text-align:center;background:#fff;padding:48px 32px;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="font-size:48px;margin-bottom:16px;">${icon}</div>
    <h1 style="margin:0 0 12px;color:#111827;font-size:22px;">${title}</h1>
    <p style="color:#6b7280;line-height:1.6;margin:0;">${message}</p>
  </div>
</body></html>`;
}

export default router;
