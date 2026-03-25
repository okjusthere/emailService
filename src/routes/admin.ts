import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import { requireAuth } from "../utils/auth.js";
import { config } from "../config.js";
import {
  getNextBatch,
  getStats,
  findByEmail,
  addSubscriber,
  updateSubscriberStatus,
  bulkImport,
} from "../services/subscriberService.js";
import { triggerManualSend } from "../services/scheduler.js";
import { sendTestEmail } from "../services/emailSender.js";
import { getEffectiveDailyLimit } from "../utils/warmup.js";
import { buildRecruitmentEmail } from "../templates/recruitmentEmail.js";
import { getDb } from "../db/connection.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All admin routes require auth
router.use(requireAuth);

const upload = multer({ dest: "/tmp/uploads/" });

// ── Dashboard Stats ────────────────────────────────
router.get("/stats", (_req: Request, res: Response) => {
  const db = getDb();
  const subscriberStats = getStats();

  // Recent batches
  const recentBatches = db
    .prepare(`SELECT * FROM batches ORDER BY created_at DESC LIMIT 10`)
    .all();

  // Today's send count
  const todaySent = db
    .prepare(
      `SELECT COUNT(*) as count FROM send_logs WHERE date(sent_at) = date('now')`
    )
    .get() as { count: number };

  // Engagement stats
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

  // Warmup status
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

// ── Subscriber List ────────────────────────────────
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

// ── Delete Subscriber ──────────────────────────────
router.delete("/subscribers/:id", (req: Request, res: Response) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM subscribers WHERE id = ?")
    .run(req.params.id);
  if (result.changes > 0) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Subscriber not found" });
  }
});

// ── Add Single Subscriber ──────────────────────────
router.post("/subscribers", (req: Request, res: Response) => {
  const { email, name } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  const sub = addSubscriber(email, name);
  if (sub) {
    res.json({ success: true, subscriber: sub });
  } else {
    res.status(409).json({ error: "Subscriber already exists" });
  }
});

// ── Bulk Delete ────────────────────────────────────
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

// ── Bulk Status Update ─────────────────────────────
router.post("/subscribers/bulk-status", (req: Request, res: Response) => {
  const { ids, status } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || !status) {
    res.status(400).json({ error: "ids array and status are required" });
    return;
  }
  const validStatuses = ["active", "unsubscribed", "bounced", "complained"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `Invalid status. Valid: ${validStatuses.join(", ")}` });
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

// ── CSV Export ──────────────────────────────────────
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

  // Build CSV
  const header = "email,name,status,send_count,last_sent_at,created_at";
  const rows = subscribers.map(
    (s) =>
      `"${s.email}","${s.name || ""}","${s.status}",${s.send_count || 0},"${s.last_sent_at || ""}","${s.created_at}"`
  );
  const csv = [header, ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="subscribers_${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
});

// ── CSV Upload ─────────────────────────────────────
router.post(
  "/subscribers/upload",
  upload.single("csv"),
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

      const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
      const emailIdx = header.indexOf("email");
      const nameIdx = header.indexOf("name");

      if (emailIdx === -1) {
        res.status(400).json({ error: 'CSV must have an "email" column' });
        return;
      }

      const users: { email: string; name?: string }[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const email = cols[emailIdx];
        if (!email || !email.includes("@")) continue;
        users.push({
          email: email.toLowerCase(),
          name: nameIdx >= 0 ? cols[nameIdx] || undefined : undefined,
        });
      }

      const result = bulkImport(users);
      res.json({
        success: true,
        imported: result.imported,
        skipped: result.skipped,
        total: users.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    } finally {
      if (req.file) fs.unlinkSync(req.file.path);
    }
  }
);

// ── Email Content ──────────────────────────────────
const CONTENT_PATH = "data/email_content.json";

function getEmailContent(): {
  subject: string;
  bodyHtml: string;
  bodyText: string;
} {
  try {
    if (fs.existsSync(CONTENT_PATH)) {
      return JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
    }
  } catch {}
  return {
    subject: "Join Us — Grow Your Real Estate Career",
    bodyHtml: `
    <p>We're looking for talented and driven real estate professionals to join our growing team.</p>
    <p><strong>Why Us?</strong></p>
    <ul>
      <li>Competitive commission splits</li>
      <li>Comprehensive training and mentorship</li>
      <li>Advanced technology and marketing support</li>
      <li>A collaborative, growth-oriented culture</li>
    </ul>
    <p>Interested? Reply to this email to learn more.</p>
    <p>Best regards,<br><strong>The Recruiting Team</strong></p>`,
    bodyText: `We're looking for talented and driven real estate professionals to join our growing team.

Why Us?
- Competitive commission splits
- Comprehensive training and mentorship
- Advanced technology and marketing support
- A collaborative, growth-oriented culture

Interested? Reply to this email to learn more.

Best regards,
The Recruiting Team`,
  };
}

function saveEmailContent(content: {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}): void {
  const dir = "data";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2));
}

router.get("/email-content", (_req: Request, res: Response) => {
  res.json(getEmailContent());
});

router.put("/email-content", (req: Request, res: Response) => {
  const { subject, bodyHtml, bodyText } = req.body;
  if (!subject || !bodyHtml || !bodyText) {
    res.status(400).json({ error: "subject, bodyHtml, bodyText are required" });
    return;
  }
  saveEmailContent({ subject, bodyHtml, bodyText });
  logger.info("Email content updated via admin");
  res.json({ success: true });
});

// ── Full Email Preview ─────────────────────────────
router.get("/email-preview", (_req: Request, res: Response) => {
  const content = getEmailContent();
  const fullHtml = buildRecruitmentEmail({
    recipientName: "John Doe",
    subject: content.subject,
    bodyHtml: content.bodyHtml,
    unsubscribeUrl: `${config.baseUrl}/unsubscribe?token=preview-token`,
  });
  res.send(fullHtml);
});

// ── Test Send ──────────────────────────────────────
router.post("/test-send", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  const content = getEmailContent();
  const result = await sendTestEmail(email, content);
  if (result.success) {
    res.json({ success: true, message: `Test email sent to ${email}` });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// ── Send Now ───────────────────────────────────────
router.post("/send-now", async (_req: Request, res: Response) => {
  try {
    const content = getEmailContent();
    await triggerManualSend(content);
    res.json({ success: true, message: "Send triggered" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Send History ───────────────────────────────────
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

// ── Login check ────────────────────────────────────
router.get("/me", (_req: Request, res: Response) => {
  res.json({ authenticated: true });
});

export { getEmailContent };
export default router;
