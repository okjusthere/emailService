import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { getEmailProvider } from "../../email/providers/index.js";
import { unsubscribeByToken } from "../../modules/suppressions/unsubscribe.js";
import { ingestWebhook } from "../../modules/webhooks/service.js";
import { DomainError } from "../../shared/errors.js";

export const publicRouter = Router();
const unsubscribeLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

publicRouter.post("/webhooks/resend", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  try {
    const result = await ingestWebhook(getEmailProvider(), {
      rawBody,
      headers: {
        "svix-id": req.get("svix-id") ?? undefined,
        "svix-timestamp": req.get("svix-timestamp") ?? undefined,
        "svix-signature": req.get("svix-signature") ?? undefined,
      },
    });
    res.status(200).json(result);
  } catch {
    throw new DomainError(
      "WEBHOOK_SIGNATURE_INVALID",
      "Webhook signature or payload is invalid.",
      401
    );
  }
});

publicRouter.post("/unsubscribe/confirm", unsubscribeLimit, async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(1000) }).parse(req.body);
  const result = await unsubscribeByToken(token, "VISIBLE_LINK");
  res.type("html").send(successPage(result.emailMasked));
});

publicRouter.post("/unsubscribe/one-click", unsubscribeLimit, async (req, res) => {
  const token = z
    .string()
    .min(20)
    .max(1000)
    .parse(req.query.token ?? req.body.token);
  await unsubscribeByToken(token, "ONE_CLICK");
  res.status(204).end();
});

function successPage(email: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head><body style="font-family:system-ui;max-width:560px;margin:80px auto;padding:24px"><h1>You’re unsubscribed</h1><p>${email} will no longer receive Homix Realty marketing emails.</p></body></html>`;
}
