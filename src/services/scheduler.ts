import cron from "node-cron";
import fs from "fs";
import { config } from "../config.js";
import { executeDailySend } from "./emailSender.js";
import { getStats } from "./subscriberService.js";
import { logger } from "../utils/logger.js";

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Load email content from the saved JSON file, or use defaults.
 */
function loadEmailContent(): {
  subject: string;
  bodyHtml: string;
  bodyText: string;
} {
  try {
    const path = "data/email_content.json";
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, "utf-8"));
    }
  } catch {}
  return {
    subject: "Join Us — Grow Your Real Estate Career",
    bodyHtml: `<p>We're looking for talented and driven real estate professionals to join our growing team.</p>
    <p>Interested? Reply to this email to learn more.</p>
    <p>Best regards,<br><strong>The Recruiting Team</strong></p>`,
    bodyText: `We're looking for talented real estate professionals to join our growing team.\n\nInterested? Reply to this email to learn more.\n\nBest regards,\nThe Recruiting Team`,
  };
}

/**
 * Start the cron scheduler for daily email sends
 */
export function startScheduler(): void {
  // Skip if cron is not configured or explicitly disabled
  if (!config.sendCron || config.sendCron === "disabled") {
    logger.info("Scheduler disabled — use /admin to send manually");
    return;
  }

  if (scheduledTask) {
    logger.warn("Scheduler is already running");
    return;
  }

  logger.info(`Scheduling daily send: cron = "${config.sendCron}"`);

  scheduledTask = cron.schedule(config.sendCron, async () => {
    logger.info("=== Daily send triggered ===");
    const stats = getStats();
    logger.info("Subscriber stats before send:", stats);

    try {
      const content = loadEmailContent();
      const result = await executeDailySend(content);
      logger.success(
        `Daily send finished. Batch: ${result.batchId}, Sent: ${result.totalSent}, Failed: ${result.totalFailed}`
      );
    } catch (err: any) {
      logger.error(`Daily send failed: ${err.message}`, err);
    }
  });

  logger.success("Scheduler started");
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info("Scheduler stopped");
  }
}

/**
 * Trigger an immediate send (for testing or manual trigger)
 */
export async function triggerManualSend(
  content?: { subject: string; bodyHtml: string; bodyText: string }
): Promise<void> {
  logger.info("=== Manual send triggered ===");
  const stats = getStats();
  logger.info("Subscriber stats:", stats);

  try {
    const emailContent = content || loadEmailContent();
    const result = await executeDailySend(emailContent);
    logger.success(
      `Manual send finished. Batch: ${result.batchId}, Sent: ${result.totalSent}, Failed: ${result.totalFailed}`
    );
  } catch (err: any) {
    logger.error(`Manual send failed: ${err.message}`, err);
  }
}
