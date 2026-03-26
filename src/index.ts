import express from "express";
import path from "path";
import { config } from "./config.js";
import { getDb } from "./db/connection.js";
import { runMigrations } from "./db/schema.js";
import { startWorker } from "./services/scheduler.js";
import webhookRoutes from "./routes/webhook.js";
import unsubscribeRoutes from "./routes/unsubscribe.js";
import adminRoutes from "./routes/admin.js";
import subscribeRoutes from "./routes/subscribe.js";
import { logger } from "./utils/logger.js";

const app = express();

function formatError(err: unknown): unknown {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return err;
}

// Parse JSON bodies (for webhooks + API)
app.use(express.json());
// Parse URL-encoded bodies (for unsubscribe form)
app.use(express.urlencoded({ extended: true }));

// Serve admin dashboard static files
app.use("/admin", express.static(path.join(process.cwd(), "public")));
app.use(
  "/email-assets",
  express.static(path.join(process.cwd(), "data", "email-assets"))
);

// Routes
app.use("/webhook", webhookRoutes);
app.use("/unsubscribe", unsubscribeRoutes);
app.use("/api/admin", adminRoutes);

// CORS for public subscribe API (needed for embed forms on other domains)
app.use("/api/subscribe", (_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});
app.use("/api/subscribe", subscribeRoutes);
// Standalone subscribe page (public)
app.get("/subscribe", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "subscribe.html"));
});

// Embed snippet generator (for admin to copy-paste into other sites)
app.get("/api/subscribe/embed", (_req, res) => {
  const embedCode = `<!-- Email Subscribe Form -->
<form id="email-subscribe-form" style="max-width:400px;font-family:sans-serif;">
  <input type="email" name="email" placeholder="Your email" required
    style="width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font-size:15px;margin-bottom:8px;">
  <input type="text" name="name" placeholder="Name (optional)"
    style="width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:6px;font-size:15px;margin-bottom:8px;">
  <button type="submit"
    style="width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;">
    Subscribe
  </button>
  <p id="subscribe-msg" style="text-align:center;margin-top:8px;font-size:14px;"></p>
</form>
<script>
document.getElementById("email-subscribe-form").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.target);const msg=document.getElementById("subscribe-msg");
  try{const r=await fetch("${config.baseUrl}/api/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:f.get("email"),name:f.get("name")||undefined})});const d=await r.json();
    msg.textContent=d.message||d.error;msg.style.color=r.ok?"#059669":"#dc2626";
    if(r.ok)e.target.reset();}catch{msg.textContent="Error. Please try again.";msg.style.color="#dc2626";}
});
</script>`;
  res.json({ embedCode });
});

// Health check (public)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Redirect root to admin
app.get("/", (_req, res) => {
  res.redirect("/admin");
});

// ── Bootstrap ──────────────────────────────────────
function bootstrap(): void {
  try {
    logger.info("Bootstrap start");
    logger.info("Initializing database");
    getDb();

    logger.info("Running migrations");
    runMigrations();

    logger.info("Starting job worker");
    startWorker();

    logger.info("Starting HTTP server");
    app.listen(config.port, () => {
      logger.success(`Email Service running on port ${config.port}`);
      logger.info(`  Admin:       http://localhost:${config.port}/admin`);
      logger.info(`  Health:      http://localhost:${config.port}/health`);
      logger.info(`  Webhook:     http://localhost:${config.port}/webhook/resend`);
      logger.info(`  Unsubscribe: http://localhost:${config.port}/unsubscribe?token=xxx`);
    });
  } catch (err) {
    logger.error("Bootstrap failed", formatError(err));
    process.exit(1);
  }
}

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", formatError(err));
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", formatError(reason));
});

bootstrap();
