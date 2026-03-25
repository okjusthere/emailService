import express from "express";
import path from "path";
import { config } from "./config.js";
import { getDb } from "./db/connection.js";
import { runMigrations } from "./db/schema.js";
import { startScheduler } from "./services/scheduler.js";
import webhookRoutes from "./routes/webhook.js";
import unsubscribeRoutes from "./routes/unsubscribe.js";
import adminRoutes from "./routes/admin.js";
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

// Routes
app.use("/webhook", webhookRoutes);
app.use("/unsubscribe", unsubscribeRoutes);
app.use("/api/admin", adminRoutes);

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

    logger.info("Starting scheduler");
    startScheduler();

    logger.info("Starting HTTP server");
    app.listen(config.port, () => {
      logger.success(`Email Service running on port ${config.port}`);
      logger.info(`  Admin:       http://localhost:${config.port}/admin`);
      logger.info(`  Health:      http://localhost:${config.port}/health`);
      logger.info(`  Webhook:     http://localhost:${config.port}/webhook/resend`);
      logger.info(`  Unsubscribe: http://localhost:${config.port}/unsubscribe?token=xxx`);
      logger.info(`  Cron:        ${config.sendCron}`);
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
