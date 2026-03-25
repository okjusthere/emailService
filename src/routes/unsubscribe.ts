import { Router, type Request, type Response } from "express";
import {
  findByToken,
  unsubscribeByToken,
} from "../services/subscriberService.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * GET /unsubscribe?token=xxx
 *
 * Shows a confirmation page before unsubscribing.
 * CAN-SPAM requires: easy, no extra info needed, single webpage visit.
 */
router.get("/", (req: Request, res: Response) => {
  const token = req.query.token as string;

  if (!token) {
    res.status(400).send(renderPage("Invalid Link", "<p>This unsubscribe link is invalid.</p>"));
    return;
  }

  const subscriber = findByToken(token);

  if (!subscriber) {
    res.status(404).send(renderPage("Not Found", "<p>This unsubscribe link is invalid or has expired.</p>"));
    return;
  }

  if (subscriber.status === "unsubscribed") {
    res.send(renderPage("Already Unsubscribed", "<p>You have already been unsubscribed. You will not receive any more emails from us.</p>"));
    return;
  }

  // Show confirmation page
  res.send(
    renderPage(
      "Unsubscribe",
      `
      <p>Are you sure you want to unsubscribe <strong>${subscriber.email}</strong> from ${config.company.name} emails?</p>
      <form method="POST" action="/unsubscribe">
        <input type="hidden" name="token" value="${token}">
        <div style="margin-top: 16px;">
          <label for="reason" style="display: block; margin-bottom: 8px; color: #555;">Reason (optional):</label>
          <select id="reason" name="reason" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 16px;">
            <option value="">-- Select a reason --</option>
            <option value="too_frequent">Emails are too frequent</option>
            <option value="not_relevant">Content is not relevant to me</option>
            <option value="not_interested">Not interested anymore</option>
            <option value="other">Other</option>
          </select>
        </div>
        <button type="submit" style="background-color: #e53e3e; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 6px; cursor: pointer;">
          Confirm Unsubscribe
        </button>
      </form>
      `
    )
  );
});

/**
 * POST /unsubscribe
 *
 * Processes the unsubscribe request. CAN-SPAM requires honoring within 10 business days;
 * we process immediately.
 */
router.post("/", (req: Request, res: Response) => {
  const { token, reason } = req.body;

  if (!token) {
    res.status(400).send(renderPage("Error", "<p>Missing unsubscribe token.</p>"));
    return;
  }

  const success = unsubscribeByToken(token, reason);

  if (success) {
    logger.info(`Unsubscribed via web form, token: ${token}, reason: ${reason || "none"}`);
    res.send(
      renderPage(
        "Unsubscribed",
        `
        <p style="color: #38a169; font-size: 18px;">✅ You have been successfully unsubscribed.</p>
        <p>You will no longer receive emails from ${config.company.name}.</p>
        <p style="color: #718096; font-size: 14px;">If this was a mistake, please contact us at <a href="mailto:${config.replyToEmail}">${config.replyToEmail}</a>.</p>
        `
      )
    );
  } else {
    res.status(400).send(
      renderPage("Error", "<p>Unable to process your unsubscribe request. The link may be invalid or you may have already been unsubscribed.</p>")
    );
  }
});

/**
 * Render a simple HTML page
 */
function renderPage(title: string, bodyContent: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${config.company.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f7fafc; margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 40px; max-width: 480px; width: 100%; margin: 20px; }
    h1 { color: #1a365d; margin-top: 0; font-size: 24px; }
    p { line-height: 1.6; color: #4a5568; }
    a { color: #4a6fa5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    ${bodyContent}
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="font-size: 12px; color: #a0aec0;">${config.company.name} · ${config.company.address}</p>
  </div>
</body>
</html>`.trim();
}

export default router;
