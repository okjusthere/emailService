import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import { requireAuth } from "../utils/auth.js";
import { config } from "../config.js";
import { getStats, addSubscriber, bulkImport } from "../services/subscriberService.js";
import { triggerManualSend } from "../services/scheduler.js";
import { sendTestEmail } from "../services/emailSender.js";
import { getEffectiveDailyLimit } from "../utils/warmup.js";
import { buildRecruitmentEmail } from "../templates/recruitmentEmail.js";
import { getDb } from "../db/connection.js";
import { logger } from "../utils/logger.js";
import {
  createEmailAsset,
  deleteEmailAsset,
  hasEmbeddedAssets,
  isAllowedEmailAssetType,
  listEmailAssets,
  MAX_EMAIL_ASSET_SIZE,
  resolveAssetPlaceholdersToPublicUrls,
} from "../services/emailAssetService.js";
import {
  getEmailContent,
  normalizeEmailContent,
  saveEmailContent,
  type EmailContent,
} from "../services/emailContentService.js";

const router = Router();

router.use(requireAuth);

const csvUpload = multer({ dest: "/tmp/uploads/" });
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EMAIL_ASSET_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedEmailAssetType(file.mimetype)) {
      cb(new Error("Unsupported image type. Use PNG, JPG, GIF, or WebP."));
      return;
    }

    cb(null, true);
  },
});

function getRequestBaseUrl(req: Request): string {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return host ? `${proto}://${host}` : config.baseUrl;
}

function buildEmailContentResponse(content: EmailContent) {
  return {
    ...content,
    deliveryMode: hasEmbeddedAssets(content.bodyHtml) ? "inline" : "batch",
  };
}

function buildPreviewEmail(content: EmailContent, baseUrl: string): string {
  const resolved = resolveAssetPlaceholdersToPublicUrls(content.bodyHtml, baseUrl);

  if (resolved.missingAssetIds.length > 0) {
    logger.warn("Preview is missing embedded assets", resolved.missingAssetIds);
  }

  return buildRecruitmentEmail({
    recipientName: "John Doe",
    subject: content.subject,
    bodyHtml: resolved.html,
    unsubscribeUrl: `${baseUrl}/unsubscribe?token=preview-token`,
  });
}

router.get("/stats", (_req: Request, res: Response) => {
  const db = getDb();
  const subscriberStats = getStats();

  const recentBatches = db
    .prepare(`SELECT * FROM batches ORDER BY created_at DESC LIMIT 10`)
    .all();

  const todaySent = db
    .prepare(
      `SELECT COUNT(*) as count FROM send_logs WHERE date(sent_at) = date('now')`
    )
    .get() as { count: number };

  const engagement = db
    .prepare(
      `SELECT
        COUNT(*) as total_sent,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'opened' THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN status = 'clicked' THEN 1 ELSE 0 END) as clicked,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) as complained
      FROM send_logs`
    )
    .get() as any;

  const warmup = getEffectiveDailyLimit();

  res.json({
    subscribers: subscriberStats,
    recentBatches,
    todaySentCount: todaySent.count,
    engagement: {
      totalSent: engagement.total_sent || 0,
      delivered: engagement.delivered || 0,
      opened: engagement.opened || 0,
      clicked: engagement.clicked || 0,
      bounced: engagement.bounced || 0,
      complained: engagement.complained || 0,
      openRate: engagement.delivered
        ? ((engagement.opened / engagement.delivered) * 100).toFixed(1)
        : "0.0",
      clickRate: engagement.delivered
        ? ((engagement.clicked / engagement.delivered) * 100).toFixed(1)
        : "0.0",
      bounceRate: engagement.total_sent
        ? ((engagement.bounced / engagement.total_sent) * 100).toFixed(1)
        : "0.0",
    },
    warmup: {
      isWarmingUp: warmup.isWarmingUp,
      day: warmup.warmupDay,
      limit: warmup.limit,
    },
  });
});

router.get("/subscribers", (req: Request, res: Response) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const status = req.query.status as string;
  const search = req.query.search as string;
  const offset = (page - 1) * limit;

  let where = "1=1";
  const params: any[] = [];

  if (status && status !== "all") {
    where += " AND status = ?";
    params.push(status);
  }

  if (search) {
    where += " AND (email LIKE ? OR name LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM subscribers WHERE ${where}`)
    .get(...params) as { count: number };

  const subscribers = db
    .prepare(
      `SELECT id, email, name, status, send_count, last_sent_at, created_at
       FROM subscribers WHERE ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({
    subscribers,
    pagination: {
      page,
      limit,
      total: total.count,
      totalPages: Math.ceil(total.count / limit),
    },
  });
});

router.delete("/subscribers/:id", (req: Request, res: Response) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM subscribers WHERE id = ?")
    .run(req.params.id);

  if (result.changes > 0) {
    res.json({ success: true });
    return;
  }

  res.status(404).json({ error: "Subscriber not found" });
});

router.post("/subscribers", (req: Request, res: Response) => {
  const { email, name } = req.body;

  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const subscriber = addSubscriber(email, name);

  if (!subscriber) {
    res.status(409).json({ error: "Subscriber already exists" });
    return;
  }

  res.json({ success: true, subscriber });
});

router.post("/subscribers/bulk-delete", (req: Request, res: Response) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }

  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM subscribers WHERE id IN (${placeholders})`)
    .run(...ids);

  res.json({ success: true, deleted: result.changes });
});

router.post("/subscribers/bulk-status", (req: Request, res: Response) => {
  const { ids, status } = req.body;

  if (!Array.isArray(ids) || ids.length === 0 || !status) {
    res.status(400).json({ error: "ids array and status are required" });
    return;
  }

  const validStatuses = ["active", "unsubscribed", "bounced", "complained"];

  if (!validStatuses.includes(status)) {
    res.status(400).json({
      error: `Invalid status. Valid: ${validStatuses.join(", ")}`,
    });
    return;
  }

  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const result = db
    .prepare(
      `UPDATE subscribers SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`
    )
    .run(status, ...ids);

  res.json({ success: true, updated: result.changes });
});

router.get("/subscribers/export", (req: Request, res: Response) => {
  const db = getDb();
  const status = req.query.status as string;

  let where = "1=1";
  const params: any[] = [];

  if (status && status !== "all") {
    where += " AND status = ?";
    params.push(status);
  }

  const subscribers = db
    .prepare(
      `SELECT email, name, status, send_count, last_sent_at, created_at
       FROM subscribers WHERE ${where} ORDER BY created_at DESC`
    )
    .all(...params) as any[];

  const header = "email,name,status,send_count,last_sent_at,created_at";
  const rows = subscribers.map(
    (subscriber) =>
      `"${subscriber.email}","${subscriber.name || ""}","${subscriber.status}",${subscriber.send_count || 0},"${subscriber.last_sent_at || ""}","${subscriber.created_at}"`
  );
  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="subscribers_${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
});

router.post(
  "/subscribers/upload",
  csvUpload.single("csv"),
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    try {
      const content = fs.readFileSync(req.file.path, "utf-8");
      const lines = content.trim().split("\n");

      if (lines.length < 2) {
        res.status(400).json({ error: "CSV must have header + at least 1 row" });
        return;
      }

      const header = lines[0].toLowerCase().split(",").map((part) => part.trim());
      const emailIndex = header.indexOf("email");
      const nameIndex = header.indexOf("name");

      if (emailIndex === -1) {
        res.status(400).json({ error: 'CSV must have an "email" column' });
        return;
      }

      const users: { email: string; name?: string }[] = [];

      for (let index = 1; index < lines.length; index++) {
        const columns = lines[index]
          .split(",")
          .map((part) => part.trim().replace(/^"|"$/g, ""));
        const email = columns[emailIndex];

        if (!email || !email.includes("@")) {
          continue;
        }

        users.push({
          email: email.toLowerCase(),
          name: nameIndex >= 0 ? columns[nameIndex] || undefined : undefined,
        });
      }

      const result = bulkImport(users);
      res.json({
        success: true,
        imported: result.imported,
        skipped: result.skipped,
        total: users.length,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    } finally {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }
  }
);

router.get("/email-assets", (req: Request, res: Response) => {
  res.json({ assets: listEmailAssets(getRequestBaseUrl(req)) });
});

router.post("/email-assets", (req: Request, res: Response) => {
  imageUpload.single("image")(req, res, (error) => {
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No image uploaded" });
      return;
    }

    try {
      const asset = createEmailAsset({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        baseUrl: getRequestBaseUrl(req),
      });

      logger.info("Email asset uploaded", {
        id: asset.id,
        name: asset.originalName,
      });

      res.json({ success: true, asset });
    } catch (uploadError: any) {
      res.status(400).json({ error: uploadError.message });
    }
  });
});

router.delete("/email-assets/:id", (req: Request, res: Response) => {
  const assetId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!deleteEmailAsset(assetId)) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  logger.info("Email asset deleted", { id: assetId });
  res.json({ success: true });
});

router.get("/email-content", (_req: Request, res: Response) => {
  res.json(buildEmailContentResponse(getEmailContent()));
});

router.put("/email-content", (req: Request, res: Response) => {
  const { subject, bodyHtml, bodyText } = req.body;

  if (!subject || !bodyHtml || !bodyText) {
    res.status(400).json({ error: "subject, bodyHtml, bodyText are required" });
    return;
  }

  const savedContent = saveEmailContent({ subject, bodyHtml, bodyText });
  logger.info("Email content updated via admin");
  res.json({ success: true, content: buildEmailContentResponse(savedContent) });
});

router.get("/email-preview", (req: Request, res: Response) => {
  res.send(buildPreviewEmail(getEmailContent(), getRequestBaseUrl(req)));
});

router.post("/email-preview", (req: Request, res: Response) => {
  const { subject, bodyHtml, bodyText } = req.body;

  if (!subject || !bodyHtml) {
    res.status(400).json({ error: "subject and bodyHtml are required" });
    return;
  }

  const content = normalizeEmailContent({
    subject,
    bodyHtml,
    bodyText: bodyText || "",
  });

  res.send(buildPreviewEmail(content, getRequestBaseUrl(req)));
});

router.post("/test-send", async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const result = await sendTestEmail(email, getEmailContent());

  if (result.success) {
    res.json({ success: true, message: `Test email sent to ${email}` });
    return;
  }

  res.status(500).json({ error: result.error });
});

router.post("/send-now", async (_req: Request, res: Response) => {
  try {
    await triggerManualSend(getEmailContent());
    res.json({ success: true, message: "Send triggered" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/batches", (_req: Request, res: Response) => {
  const db = getDb();
  const batches = db
    .prepare(`SELECT * FROM batches ORDER BY created_at DESC LIMIT 50`)
    .all();
  res.json({ batches });
});

router.get("/batches/:id/logs", (req: Request, res: Response) => {
  const db = getDb();
  const logs = db
    .prepare(
      `SELECT sl.*, s.email, s.name
       FROM send_logs sl
       JOIN subscribers s ON s.id = sl.subscriber_id
       WHERE sl.batch_id = ?
       ORDER BY sl.created_at DESC
       LIMIT 200`
    )
    .all(req.params.id);
  res.json({ logs });
});

router.get("/me", (_req: Request, res: Response) => {
  res.json({ authenticated: true });
});

export default router;
