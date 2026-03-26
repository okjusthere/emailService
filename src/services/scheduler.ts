import { sendCampaignChunk, type EmailContent } from "./emailSender.js";
import {
  createJob,
  claimNextJob,
  completeJob,
  failJob,
  recoverStuckJobs,
  type Job,
} from "./jobService.js";
import {
  markCampaignFailed,
  getCampaign,
  markCampaignSending,
  markCampaignSent,
} from "./campaignService.js";
import { getDb } from "../db/connection.js";
import { logger } from "../utils/logger.js";

let workerInterval: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 2000;

/**
 * Process a single job based on its type.
 */
async function processJob(job: Job): Promise<void> {
  const payload = JSON.parse(job.payload);
  logger.info(`Processing job ${job.id} (type: ${job.type}, attempt ${job.attempts})`);

  switch (job.type) {
    case "campaign_send": {
      const { campaignId, tagIds, chunkSize, intervalMinutes, totalSent = 0, totalFailed = 0, chunkIndex = 1 } = payload;
      const campaign = getCampaign(campaignId);

      if (!campaign) {
        failJob(job.id, `Campaign ${campaignId} not found`);
        return;
      }

      const content: EmailContent = {
        subject: campaign.subject,
        bodyHtml: campaign.body_html,
        bodyText: campaign.body_text,
        templateMode: campaign.template_mode,
      };

      // Ensure campaign is marked as sending
      if (campaign.status !== "sending") {
        markCampaignSending(campaign.id);
      }

      const result = await sendCampaignChunk(content, campaignId, chunkSize || 50, tagIds || undefined);
      const newTotalSent = totalSent + result.sent;
      const newTotalFailed = totalFailed + result.failed;

      if (result.remaining > 0) {
        // More subscribers to send — chain next chunk job with delay
        const delay = (intervalMinutes || 10) * 60 * 1000;
        const runAfter = new Date(Date.now() + delay);

        createJob("campaign_send", {
          campaignId,
          tagIds,
          chunkSize,
          intervalMinutes,
          totalSent: newTotalSent,
          totalFailed: newTotalFailed,
          chunkIndex: chunkIndex + 1,
        }, { runAfter });

        // Complete this chunk job with intermediate result
        completeJob(job.id, {
          chunkIndex,
          sent: result.sent,
          failed: result.failed,
          totalSent: newTotalSent,
          totalFailed: newTotalFailed,
          remaining: result.remaining,
          status: "dripping",
          nextChunkAt: runAfter.toISOString(),
        });

        // Update campaign progress (partial)
        const db = getDb();
        db.prepare(
          `UPDATE campaigns SET sent_count = ?, failed_count = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(newTotalSent, newTotalFailed, campaignId);

        logger.info(
          `Drip chunk ${chunkIndex} done: +${result.sent} sent, ${result.remaining} remaining. ` +
          `Next chunk in ${intervalMinutes}min`
        );
      } else {
        // All done — mark campaign as sent
        markCampaignSent(campaignId, newTotalSent, newTotalFailed);
        completeJob(job.id, {
          chunkIndex,
          sent: result.sent,
          failed: result.failed,
          totalSent: newTotalSent,
          totalFailed: newTotalFailed,
          remaining: 0,
          status: "complete",
        });

        logger.success(
          `Campaign ${campaignId} drip-send complete! Total: ${newTotalSent} sent, ${newTotalFailed} failed (${chunkIndex} chunks)`
        );
      }
      break;
    }

    case "test_send": {
      const { email, content } = payload;
      const { sendTestEmail } = await import("./emailSender.js");
      const result = await sendTestEmail(email, content);

      if (result.success) {
        completeJob(job.id, { success: true });
      } else {
        throw new Error(result.error || "Test send failed");
      }
      break;
    }

    default:
      failJob(job.id, `Unknown job type: ${job.type}`);
  }
}

/**
 * Single tick of the worker loop.
 */
async function tick(): Promise<void> {
  try {
    const job = claimNextJob();
    if (!job) return;

    try {
      await processJob(job);
    } catch (err: any) {
      const message = err.message || "Unknown error";
      failJob(job.id, message);

      if (job.type === "campaign_send" && job.attempts >= job.max_attempts) {
        const payload = JSON.parse(job.payload);
        if (payload.campaignId) {
          markCampaignFailed(payload.campaignId);
        }
      }
    }
  } catch (err: any) {
    logger.error(`Job worker tick error: ${err.message}`);
  }
}

/**
 * Start the job worker that polls for pending jobs.
 */
export function startWorker(): void {
  if (workerInterval) {
    logger.warn("Job worker is already running");
    return;
  }

  // Recover any jobs stuck in 'running' from a previous crash
  recoverStuckJobs();

  workerInterval = setInterval(tick, POLL_INTERVAL_MS);
  logger.success(`Job worker started (polling every ${POLL_INTERVAL_MS}ms)`);
}

/**
 * Stop the job worker.
 */
export function stopWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("Job worker stopped");
  }
}

export function isWorkerRunning(): boolean {
  return workerInterval !== null;
}
