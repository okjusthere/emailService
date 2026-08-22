import { randomUUID } from "node:crypto";
import { config } from "../config/index.js";
import { claimDueJob } from "../db/rawQueries.js";
import { prisma } from "../db/prisma.js";
import { sanitizeErrorMessage } from "../shared/normalize.js";
import { logger } from "../shared/logger.js";
import { handleJob } from "./handlers/index.js";

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
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lockExpiresAt: null,
          },
        });
      } catch (error) {
        const message = sanitizeErrorMessage(error);
        const terminal = job.attempts >= job.maxAttempts;
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: terminal ? "FAILED" : "PENDING",
            runAt: terminal
              ? job.runAt
              : new Date(
                  Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.max(0, job.attempts - 1))
                ),
            lastError: message,
            lockedAt: null,
            lockedBy: null,
            lockExpiresAt: null,
          },
        });
        logger.error({ jobId: job.id, jobType: job.type, err: message }, "Job failed");
      } finally {
        clearInterval(renewal);
      }
    }
    logger.info({ workerId: this.workerId }, "Worker stopped");
  }
}
