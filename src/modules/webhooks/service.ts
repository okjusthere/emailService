import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import type { EmailProvider } from "../../email/providers/EmailProvider.js";
import { upsertSuppression } from "../suppressions/domain.js";
import { recomputeCampaignStats } from "../analytics/service.js";

function isTestSendEvent(payload: Prisma.JsonValue): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const tags = data.tags;
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) return false;
  return tags.test === "true" || tags.test === true;
}

export async function ingestWebhook(
  provider: EmailProvider,
  input: { rawBody: string; headers: Record<string, string | undefined> }
) {
  const verified = await provider.verifyWebhook(input);
  const webhookId = input.headers["svix-id"];
  if (!webhookId) throw new Error("Missing svix-id");
  const existing = await prisma.emailEvent.findUnique({ where: { webhookId } });
  if (existing) return { duplicate: true, id: existing.id };
  let event;
  try {
    event = await prisma.$transaction(async (tx) => {
      const recipient = verified.emailId
        ? await tx.campaignRecipient.findUnique({ where: { resendEmailId: verified.emailId } })
        : null;
      const created = await tx.emailEvent.create({
        data: {
          webhookId,
          eventType: verified.type,
          providerEmailId: verified.emailId,
          recipientEmail: verified.recipient,
          eventCreatedAt: verified.createdAt,
          campaignRecipientId: recipient?.id,
          payload: verified.payload as Prisma.InputJsonValue,
          reconciliationStatus: recipient ? "MATCHED" : "RECEIVED",
        },
      });
      await tx.job.create({
        data: {
          type: "PROCESS_WEBHOOK_EVENT",
          uniqueKey: `PROCESS_WEBHOOK_EVENT/${created.id}`,
          payload: { eventId: created.id },
        },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.emailEvent.findUniqueOrThrow({ where: { webhookId } });
      return { duplicate: true, id: duplicate.id };
    }
    throw error;
  }
  return { duplicate: false, id: event.id };
}

export async function processWebhookEvent(eventId: string): Promise<void> {
  const result = await prisma.$transaction(async (tx) => {
    const lockedEvents = await tx.$queryRaw<Array<{ id: string; reconciliation_status: string }>>(
      Prisma.sql`SELECT id, reconciliation_status FROM email_events WHERE id = ${eventId}::uuid FOR UPDATE`
    );
    if (
      !lockedEvents[0] ||
      ["PROCESSED", "DEAD_LETTER"].includes(lockedEvents[0].reconciliation_status)
    )
      return null;
    const event = await tx.emailEvent.findUniqueOrThrow({ where: { id: eventId } });
    const recipientMatch = event.campaignRecipientId
      ? await tx.campaignRecipient.findUnique({ where: { id: event.campaignRecipientId } })
      : event.providerEmailId
        ? await tx.campaignRecipient.findUnique({
            where: { resendEmailId: event.providerEmailId },
          })
        : null;
    if (!recipientMatch) {
      if (isTestSendEvent(event.payload)) {
        await tx.emailEvent.update({
          where: { id: event.id },
          data: {
            reconciliationStatus: "PROCESSED",
            processedAt: new Date(),
            nextReconcileAt: null,
            processingError: null,
          },
        });
        return null;
      }
      const retryDelaysMs = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
      const attempt = event.reconciliationAttempts + 1;
      const delayMs = retryDelaysMs[attempt - 1];
      if (delayMs === undefined) {
        await tx.emailEvent.update({
          where: { id: event.id },
          data: {
            reconciliationStatus: "DEAD_LETTER",
            reconciliationAttempts: attempt,
            nextReconcileAt: null,
            deadLetteredAt: new Date(),
            processedAt: new Date(),
            processingError: "orphan: no campaign recipient matched after reconciliation",
          },
        });
        return null;
      }
      const runAt = new Date(Date.now() + delayMs);
      await tx.emailEvent.update({
        where: { id: event.id },
        data: {
          reconciliationStatus: "RETRY_PENDING",
          reconciliationAttempts: attempt,
          nextReconcileAt: runAt,
          processingError: "orphan: no campaign recipient matched",
        },
      });
      await tx.job.upsert({
        where: { uniqueKey: `RECONCILE_WEBHOOK_EVENT/${event.id}/${attempt}` },
        create: {
          type: "RECONCILE_WEBHOOK_EVENT",
          uniqueKey: `RECONCILE_WEBHOOK_EVENT/${event.id}/${attempt}`,
          payload: { eventId: event.id },
          runAt,
          maxAttempts: 3,
        },
        update: { runAt, status: "PENDING", completedAt: null, lastError: null },
      });
      return null;
    }
    await tx.emailEvent.update({
      where: { id: event.id },
      data: { reconciliationStatus: "MATCHED", campaignRecipientId: recipientMatch.id },
    });
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM campaign_recipients WHERE id = ${recipientMatch.id}::uuid FOR UPDATE`
    );
    const recipient = await tx.campaignRecipient.findUniqueOrThrow({
      where: { id: recipientMatch.id },
    });
    const time = event.eventCreatedAt;
    const latestEventAt =
      recipient.lastProviderEventAt && recipient.lastProviderEventAt > time
        ? recipient.lastProviderEventAt
        : time;
    switch (event.eventType) {
      case "email.sent":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: { lastProviderEventAt: latestEventAt },
        });
        break;
      case "email.delivered":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            deliveredAt:
              recipient.deliveredAt && recipient.deliveredAt < time ? recipient.deliveredAt : time,
            deliveryState:
              recipient.deliveryState === "UNKNOWN" ? "DELIVERED" : recipient.deliveryState,
            lastProviderEventAt: latestEventAt,
          },
        });
        break;
      case "email.opened":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            openedAt: recipient.openedAt && recipient.openedAt < time ? recipient.openedAt : time,
            lastProviderEventAt: latestEventAt,
          },
        });
        break;
      case "email.clicked":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            clickedAt:
              recipient.clickedAt && recipient.clickedAt < time ? recipient.clickedAt : time,
            lastProviderEventAt: latestEventAt,
          },
        });
        break;
      case "email.delivery_delayed":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: { lastProviderEventAt: latestEventAt, lastErrorCode: "delivery_delayed" },
        });
        break;
      case "email.bounced":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            deliveryState: "BOUNCED",
            bouncedAt:
              recipient.bouncedAt && recipient.bouncedAt < time ? recipient.bouncedAt : time,
            lastProviderEventAt: latestEventAt,
          },
        });
        await upsertSuppression(tx, {
          email: recipient.email,
          reason: "HARD_BOUNCE",
          source: "RESEND",
          campaignId: recipient.campaignId,
          campaignRecipientId: recipient.id,
          details: { webhookId: event.webhookId },
        });
        break;
      case "email.complained":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            deliveryState: "COMPLAINED",
            complainedAt:
              recipient.complainedAt && recipient.complainedAt < time
                ? recipient.complainedAt
                : time,
            lastProviderEventAt: latestEventAt,
          },
        });
        await upsertSuppression(tx, {
          email: recipient.email,
          reason: "COMPLAINT",
          source: "RESEND",
          campaignId: recipient.campaignId,
          campaignRecipientId: recipient.id,
          details: { webhookId: event.webhookId },
        });
        break;
      case "email.suppressed":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            ...(recipient.deliveryState !== "COMPLAINED" && recipient.deliveryState !== "BOUNCED"
              ? {
                  deliveryState: "PROVIDER_SUPPRESSED",
                  providerSuppressedAt:
                    recipient.providerSuppressedAt && recipient.providerSuppressedAt < time
                      ? recipient.providerSuppressedAt
                      : time,
                }
              : {}),
            lastProviderEventAt: latestEventAt,
          },
        });
        await upsertSuppression(tx, {
          email: recipient.email,
          reason: "PROVIDER_SUPPRESSED",
          source: "RESEND",
          campaignId: recipient.campaignId,
          campaignRecipientId: recipient.id,
          details: { webhookId: event.webhookId },
        });
        break;
      case "email.failed":
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            sendState: "PERMANENT_FAILED",
            lastProviderEventAt: latestEventAt,
            lastErrorCode: "provider_failed",
          },
        });
        break;
      default:
        break;
    }
    await tx.emailEvent.update({
      where: { id: event.id },
      data: {
        campaignRecipientId: recipient.id,
        reconciliationStatus: "PROCESSED",
        processedAt: new Date(),
        nextReconcileAt: null,
        processingError: null,
      },
    });
    const immediateStats =
      event.eventType === "email.bounced" || event.eventType === "email.complained";
    if (!immediateStats) {
      const bucketMs = 10_000;
      const bucket = Math.floor(Date.now() / bucketMs);
      await tx.job.upsert({
        where: { uniqueKey: `RECOMPUTE_CAMPAIGN_STATS/${recipient.campaignId}/${bucket}` },
        create: {
          type: "RECOMPUTE_CAMPAIGN_STATS",
          uniqueKey: `RECOMPUTE_CAMPAIGN_STATS/${recipient.campaignId}/${bucket}`,
          payload: { campaignId: recipient.campaignId },
          runAt: new Date((bucket + 1) * bucketMs),
        },
        update: {},
      });
    }
    return { campaignId: recipient.campaignId, immediateStats };
  });
  if (result?.immediateStats) await recomputeCampaignStats(result.campaignId);
}
