import { JobType, UserRole, type Prisma } from "@prisma/client";
import { dispatchCampaign } from "../../modules/delivery/service.js";
import { processWebhookEvent } from "../../modules/webhooks/service.js";
import { recomputeCampaignStats } from "../../modules/analytics/service.js";
import { prisma } from "../../db/prisma.js";
import { processContactImport } from "../../modules/imports/service.js";
import { config } from "../../config/index.js";
import { snapshotCampaign } from "../../modules/campaigns/service.js";

function objectPayload(value: Prisma.JsonValue): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Job payload must be an object");
  return value as Record<string, unknown>;
}

export async function handleJob(type: JobType, payloadValue: Prisma.JsonValue): Promise<void> {
  const payload = objectPayload(payloadValue);
  switch (type) {
    case JobType.DISPATCH_CAMPAIGN:
      if (typeof payload.campaignId !== "string") throw new Error("Dispatch job lacks campaignId");
      await dispatchCampaign({
        campaignId: payload.campaignId,
        sendBatchId: typeof payload.sendBatchId === "string" ? payload.sendBatchId : undefined,
      });
      return;
    case JobType.PROCESS_WEBHOOK_EVENT:
      if (typeof payload.eventId !== "string") throw new Error("Webhook job lacks eventId");
      await processWebhookEvent(payload.eventId);
      return;
    case JobType.RECOMPUTE_CAMPAIGN_STATS:
      if (typeof payload.campaignId !== "string") throw new Error("Stats job lacks campaignId");
      await recomputeCampaignStats(payload.campaignId);
      return;
    case JobType.CLEANUP_EXPIRED_DATA:
      await prisma.$transaction(async (tx) => {
        await tx.emailEvent.deleteMany({
          where: {
            processedAt: {
              lt: new Date(Date.now() - config.webhookRetentionDays * 86_400_000),
            },
          },
        });
        await tx.auditLog.deleteMany({
          where: {
            createdAt: { lt: new Date(Date.now() - config.auditRetentionDays * 86_400_000) },
          },
        });
        const nextRunAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const uniqueKey = `CLEANUP_EXPIRED_DATA/${nextRunAt.toISOString().slice(0, 10)}`;
        await tx.job.upsert({
          where: { uniqueKey },
          create: {
            type: "CLEANUP_EXPIRED_DATA",
            uniqueKey,
            payload: {},
            runAt: nextRunAt,
            maxAttempts: 5,
          },
          update: {},
        });
      });
      return;
    case JobType.SNAPSHOT_CAMPAIGN:
      if (typeof payload.campaignId !== "string" || typeof payload.expectedVersion !== "number")
        throw new Error("Snapshot job lacks campaign identity or version");
      if (
        typeof payload.actor !== "object" ||
        payload.actor === null ||
        Array.isArray(payload.actor)
      )
        throw new Error("Snapshot job lacks actor context");
      {
        const actor = payload.actor as Record<string, unknown>;
        if (typeof actor.userId !== "string") throw new Error("Snapshot job actor lacks userId");
        try {
          await snapshotCampaign(
            payload.campaignId,
            {
              userId: actor.userId,
              role: Object.values(UserRole).includes(actor.role as UserRole)
                ? (actor.role as UserRole)
                : UserRole.VIEWER,
              requestId: typeof actor.requestId === "string" ? actor.requestId : undefined,
              maskedIp: typeof actor.maskedIp === "string" ? actor.maskedIp : undefined,
              userAgent: typeof actor.userAgent === "string" ? actor.userAgent : undefined,
            },
            payload.expectedVersion,
            typeof payload.scheduledAt === "string" ? new Date(payload.scheduledAt) : undefined,
            typeof payload.clientIdempotencyKey === "string"
              ? payload.clientIdempotencyKey
              : undefined
          );
        } catch (error) {
          await prisma.campaign.updateMany({
            where: { id: payload.campaignId, status: "SNAPSHOTTING" },
            data: { status: "READY" },
          });
          throw error;
        }
      }
      return;
    case JobType.IMPORT_CONTACTS:
      if (typeof payload.importId !== "string") throw new Error("Import job lacks importId");
      await processContactImport(payload.importId);
      return;
  }
}
