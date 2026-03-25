import cron from "node-cron";
import { config } from "../config.js";
import { executeDailySend } from "./emailSender.js";
import { getEmailContent, type EmailContent } from "./emailContentService.js";
import { getStats } from "./subscriberService.js";
import { logger } from "../utils/logger.js";

let scheduledTask: cron.ScheduledTask | null = null;

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
      const content = getEmailContent();
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
  content?: EmailContent
): Promise<void> {
  logger.info("=== Manual send triggered ===");
  const stats = getStats();
  logger.info("Subscriber stats:", stats);

  try {
    const emailContent = content || getEmailContent();
    const result = await executeDailySend(emailContent);
    logger.success(
      `Manual send finished. Batch: ${result.batchId}, Sent: ${result.totalSent}, Failed: ${result.totalFailed}`
    );
  } catch (err: any) {
    logger.error(`Manual send failed: ${err.message}`, err);
  }
}
