import type { Job } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { config } from "../config/index.js";
import { claimDueJob } from "../db/rawQueries.js";
import { prisma } from "../db/prisma.js";
import { sanitizeErrorMessage } from "../shared/normalize.js";
import { logger } from "../shared/logger.js";
import { handleJob } from "./handlers/index.js";

export async function completeClaimedJob(jobId: string, workerId: string): Promise<boolean> {
  const completed = await prisma.job.updateMany({
    where: { id: jobId, status: "RUNNING", lockedBy: workerId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
    },
  });
  return completed.count === 1;
}

export async function failClaimedJob(
  job: Job,
  workerId: string,
  message: string
): Promise<boolean> {
  const terminal = job.attempts >= job.maxAttempts;
  const failed = await prisma.job.updateMany({
    where: { id: job.id, status: "RUNNING", lockedBy: workerId },
    data: {
      status: terminal ? "FAILED" : "PENDING",
      runAt: terminal
        ? job.runAt
        : new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.max(0, job.attempts - 1))),
      lastError: message,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
    },
  });
  return failed.count === 1;
}

export class JobRunner {
  private stopping = false;
  private readonly workerId = `worker-${randomUUID()}`;

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    logger.info({ workerId: this.workerId }, "Worker started");
    let lastHeartbeatAt = 0;
    while (!this.stopping) {
      if (Date.now() - lastHeartbeatAt >= 60_000) {
        await prisma.systemSetting.upsert({
          where: { key: "WORKER_HEARTBEAT" },
          create: {
            key: "WORKER_HEARTBEAT",
            value: { workerId: this.workerId, at: new Date().toISOString() },
          },
          update: { value: { workerId: this.workerId, at: new Date().toISOString() } },
        });
        lastHeartbeatAt = Date.now();
        logger.info({ workerId: this.workerId }, "Worker heartbeat updated");
      }
      const job = await claimDueJob(this.workerId, config.jobLockSeconds);
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, config.workerPollIntervalMs));
        continue;
      }
      const renewal = setInterval(
        () => {
          void prisma.job
            .updateMany({
              where: { id: job.id, status: "RUNNING", lockedBy: this.workerId },
              data: { lockExpiresAt: new Date(Date.now() + config.jobLockSeconds * 1000) },
            })
            .catch((error: unknown) => {
              logger.error(
                { jobId: job.id, workerId: this.workerId, err: sanitizeErrorMessage(error) },
                "Job lock renewal failed"
              );
            });
        },
        Math.max(10_000, Math.floor((config.jobLockSeconds * 1000) / 3))
      );
      renewal.unref();
      try {
        await handleJob(job.type, job.payload);
        const completed = await completeClaimedJob(job.id, this.workerId);
        if (!completed)
          logger.warn(
            { jobId: job.id, workerId: this.workerId },
            "Job completed after its lease was lost; state was left unchanged"
          );
      } catch (error) {
        const message = sanitizeErrorMessage(error);
        const failed = await failClaimedJob(job, this.workerId, message);
        logger.error(
          { jobId: job.id, jobType: job.type, err: message, leaseOwned: failed },
          failed ? "Job failed" : "Job failed after its lease was lost; state was left unchanged"
        );
      } finally {
        clearInterval(renewal);
      }
    }
    logger.info({ workerId: this.workerId }, "Worker stopped");
  }
}
