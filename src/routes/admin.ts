import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import {
  clearAdminSession,
  createAdminSession,
  isValidApiSecret,
  requireAuth,
} from "../utils/auth.js";
import { config } from "../config.js";
import { getStats, addSubscriber, bulkImport, findByEmail } from "../services/subscriberService.js";
import { sendTestEmail, type EmailContent } from "../services/emailSender.js";
import { getDripConfig, getEffectiveDailyLimit } from "../utils/warmup.js";
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
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaignStats,
  markCampaignDraft,
  tryMarkCampaignSending,
} from "../services/campaignService.js";
import {
  listTags,
  createTag,
  deleteTag,
  tagSubscribers,
  untagSubscribers,
  getSubscriberTags,
  getOrCreateTag,
} from "../services/tagService.js";
import { createJob, getJob, listJobs } from "../services/jobService.js";
import {
  normalizePlainText,
  normalizeSubject,
  sanitizeEmailHtml,
} from "../utils/emailHtml.js";
import { escapeCsvField, parseCsv } from "../utils/csv.js";

const router = Router();

function normalizeCampaignInput(payload: Record<string, unknown>): {
  body_html?: string;
  body_text?: string;
  name?: string;
  subject?: string;
  tag_filter?: string | null;
} {
  const normalized: {
    body_html?: string;
    body_text?: string;
    name?: string;
    subject?: string;
    tag_filter?: string | null;
  } = {};

  if (typeof payload.name === "string") {
    normalized.name = payload.name.trim();
  }
  if (typeof payload.subject === "string") {
    normalized.subject = normalizeSubject(payload.subject);
  }
  if (typeof payload.body_html === "string") {
    normalized.body_html = sanitizeEmailHtml(payload.body_html);
  }
  if (typeof payload.body_text === "string") {
    normalized.body_text = normalizePlainText(payload.body_text);
  }
  if ("tag_filter" in payload) {
    normalized.tag_filter =
      typeof payload.tag_filter === "string" && payload.tag_filter.trim()
        ? payload.tag_filter.trim()
        : null;
  }

  return normalized;
}

router.post("/login", (req: Request, res: Response) => {
  const secret = typeof req.body?.secret === "string" ? req.body.secret : "";
  if (!isValidApiSecret(secret)) {
    res.status(401).json({ error: "Invalid secret" });
    return;
  }

  createAdminSession(res);
  res.json({ success: true });
});

router.post("/logout", (req: Request, res: Response) => {
  clearAdminSession(req, res);
  res.status(204).end();
});

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

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

function buildPreviewEmail(content: EmailContent, baseUrl: string): string {
  const resolved = resolveAssetPlaceholdersToPublicUrls(
    sanitizeEmailHtml(content.bodyHtml),
    baseUrl
  );

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

// ── Dashboard Stats ──────────────────────────────
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
        SUM(CASE WHEN status != 'failed' THEN 1 ELSE 0 END) as total_sent,
        SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
        SUM(CASE WHEN delivery_status = 'bounced' THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN delivery_status = 'complained' THEN 1 ELSE 0 END) as complained
      FROM send_logs`
    )
    .get() as any;

  const warmup = getEffectiveDailyLimit();
  const campaignCount = (db.prepare("SELECT COUNT(*) as c FROM campaigns").get() as any).c;

  res.json({
    subscribers: subscriberStats,
    recentBatches,
    todaySentCount: todaySent.count,
    campaignCount,
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

// ── Campaigns ────────────────────────────────────
router.get("/campaigns", (_req: Request, res: Response) => {
  const campaigns = listCampaigns().map((c) => ({
    ...c,
    stats: getCampaignStats(c.id),
  }));
  res.json({ campaigns });
});

router.post("/campaigns", (req: Request, res: Response) => {
  const payload = normalizeCampaignInput(req.body || {});
  const { name } = payload;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const campaign = createCampaign({ ...payload, name });
  res.json({ success: true, campaign });
});

router.get("/campaigns/:id", (req: Request, res: Response) => {
  const campaign = getCampaign(paramId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ campaign, stats: getCampaignStats(campaign.id) });
});

router.put("/campaigns/:id", (req: Request, res: Response) => {
  const campaignId = paramId(req);
  if (!getCampaign(campaignId)) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const campaign = updateCampaign(campaignId, normalizeCampaignInput(req.body || {}));
  if (!campaign) {
    res.status(409).json({ error: "Campaign is locked for sending" });
    return;
  }
  res.json({ success: true, campaign });
});

router.delete("/campaigns/:id", (req: Request, res: Response) => {
  if (deleteCampaign(paramId(req))) {
    res.json({ success: true });
    return;
  }
  res.status(404).json({ error: "Campaign not found" });
});

router.post("/campaigns/:id/duplicate", (req: Request, res: Response) => {
  const campaign = duplicateCampaign(paramId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ success: true, campaign });
});

router.get("/campaigns/:id/stats", (req: Request, res: Response) => {
  const campaign = getCampaign(paramId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json({ campaign, stats: getCampaignStats(campaign.id) });
});

router.post("/campaigns/:id/test-send", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  const campaign = getCampaign(paramId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const content: EmailContent = {
    subject: campaign.subject,
    bodyHtml: campaign.body_html,
    bodyText: campaign.body_text,
  };
  const result = await sendTestEmail(email, content);
  if (result.success) {
    res.json({ success: true, message: `Test email sent to ${email}` });
    return;
  }
  res.status(500).json({ error: result.error });
});

router.post("/campaigns/:id/send", (req: Request, res: Response) => {
  const campaign = getCampaign(paramId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  if (campaign.status === "sending" || campaign.status === "sent") {
    res.status(409).json({ error: "Campaign cannot be queued again" });
    return;
  }
  if (!campaign.subject || !campaign.body_html) {
    res.status(400).json({ error: "Campaign must have a subject and body" });
    return;
  }

  // Parse tag filter
  let tagIds: number[] | undefined;
  if (campaign.tag_filter) {
    tagIds = campaign.tag_filter.split(",").map(Number).filter(Boolean);
    if (tagIds.length === 0) tagIds = undefined;
  }

  const drip = getDripConfig({
    chunkSize: req.body?.chunkSize ? Number(req.body.chunkSize) : undefined,
    intervalMinutes: req.body?.intervalMinutes ? Number(req.body.intervalMinutes) : undefined,
  });

  if (!tryMarkCampaignSending(campaign.id)) {
    res.status(409).json({ error: "Campaign is already sending or already sent" });
    return;
  }

  let job: ReturnType<typeof createJob>;
  try {
    job = createJob("campaign_send", {
      campaignId: campaign.id,
      tagIds: tagIds || null,
      chunkSize: drip.chunkSize,
      intervalMinutes: drip.intervalMinutes,
    });
  } catch (error: any) {
    markCampaignDraft(campaign.id);
    res.status(500).json({ error: error.message || "Failed to queue campaign send" });
    return;
  }

  logger.info(
    `Campaign send queued as job ${job.id} (drip: ${drip.chunkSize}/chunk, ${drip.intervalMinutes}min interval)`
  );
  res.status(202).json({
    success: true,
    jobId: job.id,
    message: "Campaign send queued",
    drip: {
      chunkSize: drip.chunkSize,
      intervalMinutes: drip.intervalMinutes,
      dailyLimit: drip.dailyLimit,
      isWarmingUp: drip.warmup.isWarmingUp,
      warmupDay: drip.warmup.warmupDay,
    },
  });
});

router.post("/campaigns/:id/preview", (req: Request, res: Response) => {
  const campaign = getCampaign(paramId(req));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  const content: EmailContent = {
    subject: campaign.subject,
    bodyHtml: campaign.body_html,
    bodyText: campaign.body_text,
  };
  res.send(buildPreviewEmail(content, getRequestBaseUrl(req)));
});

// ── Tags ─────────────────────────────────────────
router.get("/tags", (_req: Request, res: Response) => {
  res.json({ tags: listTags() });
});

router.post("/tags", (req: Request, res: Response) => {
  const { name, color } = req.body;
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const tag = createTag(name, color);
  if (!tag) {
    res.status(409).json({ error: "Tag already exists" });
    return;
  }
  res.json({ success: true, tag });
});

router.delete("/tags/:id", (req: Request, res: Response) => {
  if (deleteTag(parseInt(paramId(req)))) {
    res.json({ success: true });
    return;
  }
  res.status(404).json({ error: "Tag not found" });
});

router.post("/subscribers/tag", (req: Request, res: Response) => {
  const { ids, tagId } = req.body;
  if (!Array.isArray(ids) || !tagId) {
    res.status(400).json({ error: "ids and tagId are required" });
    return;
  }
  const count = tagSubscribers(ids, tagId);
  res.json({ success: true, tagged: count });
});

router.post("/subscribers/untag", (req: Request, res: Response) => {
  const { ids, tagId } = req.body;
  if (!Array.isArray(ids) || !tagId) {
    res.status(400).json({ error: "ids and tagId are required" });
    return;
  }
  const count = untagSubscribers(ids, tagId);
  res.json({ success: true, untagged: count });
});

// ── Subscribers ──────────────────────────────────
router.get("/subscribers", (req: Request, res: Response) => {
  const db = getDb();
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const status = req.query.status as string;
  const search = req.query.search as string;
  const tagId = req.query.tagId as string;
  const offset = (page - 1) * limit;

  let where = "1=1";
  const params: any[] = [];
  let join = "";

  if (status && status !== "all") {
    where += " AND s.status = ?";
    params.push(status);
  }

  if (search) {
    where += " AND (s.email LIKE ? OR s.name LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  if (tagId) {
    join = "JOIN subscriber_tags st ON st.subscriber_id = s.id";
    where += " AND st.tag_id = ?";
    params.push(parseInt(tagId));
  }

  const total = db
    .prepare(`SELECT COUNT(DISTINCT s.id) as count FROM subscribers s ${join} WHERE ${where}`)
    .get(...params) as { count: number };

  const subscribers = db
    .prepare(
      `SELECT DISTINCT s.id, s.email, s.name, s.status, s.send_count, s.last_sent_at, s.created_at
       FROM subscribers s ${join}
       WHERE ${where}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as any[];

  // Attach tags to each subscriber
  const subscribersWithTags = subscribers.map((sub) => ({
    ...sub,
    tags: getSubscriberTags(sub.id),
  }));

  res.json({
    subscribers: subscribersWithTags,
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
      [
        escapeCsvField(subscriber.email),
        escapeCsvField(subscriber.name || ""),
        escapeCsvField(subscriber.status),
        subscriber.send_count || 0,
        escapeCsvField(subscriber.last_sent_at || ""),
        escapeCsvField(subscriber.created_at),
      ].join(",")
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
      const rows = parseCsv(content);

      if (rows.length < 2) {
        res.status(400).json({ error: "CSV must have header + at least 1 row" });
        return;
      }

      const header = rows[0].map((part) => part.trim().toLowerCase());
      const emailIndex = header.indexOf("email");
      const nameIndex = header.indexOf("name");
      const tagsIndex = header.indexOf("tags");

      if (emailIndex === -1) {
        res.status(400).json({ error: 'CSV must have an "email" column' });
        return;
      }

      const users: { email: string; name?: string; tags?: string[] }[] = [];

      for (let index = 1; index < rows.length; index++) {
        const columns = rows[index].map((part) => part.trim());
        const email = columns[emailIndex];

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          continue;
        }

        // Parse per-row tags (semicolon separated)
        let rowTags: string[] = [];
        if (tagsIndex >= 0 && columns[tagsIndex]) {
          rowTags = columns[tagsIndex]
            .split(";")
            .map((t) => t.trim())
            .filter(Boolean);
        }

        users.push({
          email: email.toLowerCase(),
          name: nameIndex >= 0 ? columns[nameIndex] || undefined : undefined,
          tags: rowTags.length > 0 ? rowTags : undefined,
        });
      }

      const result = bulkImport(users);

      // Parse batch tags from form field (comma separated)
      const batchTagsRaw = (req.body?.batchTags as string) || "";
      const batchTagNames = batchTagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      // Apply tags to imported subscribers
      let taggedCount = 0;
      let tagsCreated = 0;
      const tagIdCache = new Map<string, number>();

      const resolveTagId = (tagName: string): number => {
        if (tagIdCache.has(tagName)) return tagIdCache.get(tagName)!;
        const id = getOrCreateTag(tagName);
        tagIdCache.set(tagName, id);
        return id;
      };

      // Count how many tags are truly new
      const allTagNames = new Set<string>();
      for (const u of users) {
        u.tags?.forEach((t) => allTagNames.add(t));
      }
      batchTagNames.forEach((t) => allTagNames.add(t));

      // Pre-resolve all tag IDs (creates missing ones)
      for (const tagName of allTagNames) {
        resolveTagId(tagName);
      }
      tagsCreated = tagIdCache.size;

      // Apply per-row tags
      for (const u of users) {
        if (!u.tags || u.tags.length === 0) continue;
        const sub = findByEmail(u.email);
        if (!sub) continue;
        for (const tagName of u.tags) {
          const tagId = resolveTagId(tagName);
          taggedCount += tagSubscribers([sub.id], tagId);
        }
      }

      // Apply batch tags to ALL imported users
      if (batchTagNames.length > 0) {
        const allImportedIds: number[] = [];
        for (const u of users) {
          const sub = findByEmail(u.email);
          if (sub) allImportedIds.push(sub.id);
        }
        for (const tagName of batchTagNames) {
          const tagId = resolveTagId(tagName);
          taggedCount += tagSubscribers(allImportedIds, tagId);
        }
      }

      res.json({
        success: true,
        imported: result.imported,
        skipped: result.skipped,
        total: users.length,
        taggedCount,
        tagsCreated,
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

// ── Email Assets ─────────────────────────────────
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


// ── Jobs ─────────────────────────────────
router.get("/jobs", (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json({ jobs: listJobs({ status, limit: 50 }) });
});

router.get("/jobs/:id", (req: Request, res: Response) => {
  const job = getJob(paramId(req));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  // Parse JSON fields for convenience
  res.json({
    ...job,
    payload: JSON.parse(job.payload || "{}"),
    result: job.result ? JSON.parse(job.result) : null,
  });
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
