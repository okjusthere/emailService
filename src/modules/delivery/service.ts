import { createHash } from "node:crypto";
import { CampaignStatus, Prisma, type CampaignRecipient, type SenderProfile } from "@prisma/client";
import { config } from "../../config/index.js";
import { prisma } from "../../db/prisma.js";
import { reserveCampaignRecipients } from "../../db/rawQueries.js";
import { inTransaction } from "../../db/transactions.js";
import { createUnsubscribeToken, unsubscribeHeaders } from "../../email/compliance.js";
import { getEmailProvider } from "../../email/providers/index.js";
import type { ProviderMessage } from "../../email/providers/EmailProvider.js";
import { renderListingEmail, type ListingEmailSnapshot } from "../../email/render.js";
import { sanitizeErrorMessage } from "../../shared/normalize.js";
import { logger } from "../../shared/logger.js";
import { recomputeCampaignStats } from "../analytics/service.js";
import { effectiveDailyLimit, isInsideSendWindow, localDate, nextSendWindow } from "./quota.js";
import { canRetry, classifyProviderFailure, retryDelayMs } from "./retry.js";

interface DispatchPayload {
  campaignId: string;
  sendBatchId?: string;
}

function parseWarmup(value: Prisma.JsonValue | null): Array<{ day: number; limit: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const day = "day" in entry ? entry.day : undefined;
    const limit = "limit" in entry ? entry.limit : undefined;
    return typeof day === "number" && typeof limit === "number" ? [{ day, limit }] : [];
  });
}

function snapshot(value: Prisma.JsonValue | null): ListingEmailSnapshot {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("listing" in value) ||
    !("content" in value)
  )
    throw new Error("Campaign content snapshot is missing or invalid");
  return value as unknown as ListingEmailSnapshot;
}

async function messagesForBatch(
  campaign: {
    id: string;
    listingId: string | null;
    templateKey: "LISTING_BRANDED" | "BROKER_PERSONAL";
    contentSnapshot: Prisma.JsonValue | null;
    senderProfile: SenderProfile;
  },
  recipients: CampaignRecipient[]
): Promise<ProviderMessage[]> {
  const frozen = snapshot(campaign.contentSnapshot);
  return Promise.all(
    recipients.map(async (recipient) => {
      const token = createUnsubscribeToken(recipient.id, config.unsubscribeSigningSecret);
      const visibleUnsubscribeUrl = `${config.baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
      const oneClickUnsubscribeUrl = `${config.baseUrl}/api/public/unsubscribe/one-click?token=${encodeURIComponent(token)}`;
      const rendered = await renderListingEmail({
        snapshot: frozen,
        recipient: {
          firstName: recipient.firstName ?? undefined,
          fullName:
            recipient.displayName ??
            ([recipient.firstName, recipient.lastName].filter(Boolean).join(" ") || undefined),
          company: recipient.company ?? undefined,
          unsubscribeUrl: visibleUnsubscribeUrl,
        },
        templateKey: campaign.templateKey,
        live: config.deliveryMode === "live",
      });
      return {
        from: `${frozen.sender.fromName} <${frozen.sender.fromEmail}>`,
        to: recipient.email,
        replyTo: frozen.sender.replyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: unsubscribeHeaders(oneClickUnsubscribeUrl),
        tags: [
          { name: "campaign_id", value: campaign.id },
          { name: "recipient_id", value: recipient.id },
          ...(campaign.listingId ? [{ name: "listing_id", value: campaign.listingId }] : []),
        ],
      };
    })
  );
}

async function scheduleDispatch(
  campaignId: string,
  runAt: Date,
  suffix: string,
  sendBatchId?: string
) {
  await prisma.job.upsert({
    where: { uniqueKey: `DISPATCH_CAMPAIGN/${campaignId}/${suffix}` },
    create: {
      type: "DISPATCH_CAMPAIGN",
      uniqueKey: `DISPATCH_CAMPAIGN/${campaignId}/${suffix}`,
      payload: sendBatchId ? { campaignId, sendBatchId } : { campaignId },
      runAt,
    },
    update: {
      status: "PENDING",
      payload: sendBatchId ? { campaignId, sendBatchId } : { campaignId },
      runAt,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
    },
  });
}

async function finishBatch(input: {
  batchId: string;
  campaignId: string;
  senderProfileId: string;
  localDate: Date;
  items: Array<{
    id: string;
    accepted: boolean;
    providerEmailId?: string;
    code?: string;
    message?: string;
  }>;
  outcome: "ACCEPTED" | "PARTIAL" | "PERMANENT_FAILED";
}) {
  await prisma.$transaction(async (tx) => {
    let accepted = 0;
    let released = 0;
    for (const item of input.items) {
      if (item.accepted) {
        accepted += 1;
        const recipient = await tx.campaignRecipient.update({
          where: { id: item.id },
          data: {
            sendState: "ACCEPTED",
            resendEmailId: item.providerEmailId,
            acceptedAt: new Date(),
            attemptCount: { increment: 1 },
            claimToken: null,
            claimExpiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        if (recipient.contactId) {
          await tx.contact.update({
            where: { id: recipient.contactId },
            data: { lastSentAt: new Date(), sendCount: { increment: 1 } },
          });
        }
      } else {
        released += 1;
        await tx.campaignRecipient.update({
          where: { id: item.id },
          data: {
            sendState: "PERMANENT_FAILED",
            attemptCount: { increment: 1 },
            claimToken: null,
            claimExpiresAt: null,
            lastErrorCode: item.code,
            lastErrorMessage: item.message?.slice(0, 500),
          },
        });
      }
    }
    await tx.senderDailyUsage.update({
      where: {
        senderProfileId_localDate: {
          senderProfileId: input.senderProfileId,
          localDate: input.localDate,
        },
      },
      data: {
        reservedCount: { decrement: input.items.length },
        acceptedCount: { increment: accepted },
        releasedCount: { increment: released },
      },
    });
    await tx.sendBatch.update({
      where: { id: input.batchId },
      data: {
        status: input.outcome,
        acceptedCount: accepted,
        failedCount: released,
        completedAt: new Date(),
      },
    });
  });
  await recomputeCampaignStats(input.campaignId);
}

async function executeBatch(
  campaign: NonNullable<Awaited<ReturnType<typeof loadCampaign>>>,
  batchId: string,
  recipients: CampaignRecipient[],
  usageDate: Date
) {
  const suppressed = await prisma.suppression.findMany({
    where: {
      isActive: true,
      emailNormalized: { in: recipients.map((item) => item.emailNormalized) },
    },
    select: { emailNormalized: true, reason: true },
  });
  const reasonByEmail = new Map(suppressed.map((item) => [item.emailNormalized, item.reason]));
  const deliverable = recipients.filter((item) => !reasonByEmail.has(item.emailNormalized));
  if (deliverable.length !== recipients.length) {
    const blocked = recipients.filter((item) => reasonByEmail.has(item.emailNormalized));
    await prisma.$transaction(async (tx) => {
      for (const recipient of blocked) {
        await tx.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            sendState: "SUPPRESSED",
            suppressionReason: reasonByEmail.get(recipient.emailNormalized),
            sendBatchId: deliverable.length === 0 ? undefined : null,
            claimToken: null,
            claimExpiresAt: null,
          },
        });
      }
      await tx.senderDailyUsage.update({
        where: {
          senderProfileId_localDate: {
            senderProfileId: campaign.senderProfileId,
            localDate: usageDate,
          },
        },
        data: {
          reservedCount: { decrement: blocked.length },
          releasedCount: { increment: blocked.length },
        },
      });
      await tx.sendBatch.update({
        where: { id: batchId },
        data:
          deliverable.length === 0
            ? {
                status: "PERMANENT_FAILED",
                failedCount: blocked.length,
                lastErrorCode: "suppressed_before_submit",
                completedAt: new Date(),
              }
            : {
                recipientCount: deliverable.length,
                requestHash: createHash("sha256")
                  .update(
                    deliverable
                      .map((item) => item.id)
                      .sort()
                      .join(",")
                  )
                  .digest("hex"),
              },
      });
    });
    if (deliverable.length === 0) {
      await recomputeCampaignStats(campaign.id);
      return;
    }
  }
  recipients = deliverable;
  const preparedAttempt = await inTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM send_batches WHERE id = ${batchId}::uuid FOR UPDATE
    `;
    const batch = await tx.sendBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status !== "PREPARING") return null;
    const attemptNumber = batch.attemptCount + 1;
    const attempt = await tx.sendAttempt.create({
      data: {
        sendBatchId: batch.id,
        attemptNumber,
        outcome: "STARTED",
        idempotencyKey: batch.idempotencyKey,
        requestHash: batch.requestHash,
      },
    });
    await tx.sendBatch.update({
      where: { id: batch.id },
      data: {
        status: "SUBMITTING",
        attemptCount: attemptNumber,
        startedAt: batch.startedAt ?? new Date(),
      },
    });
    return { batch, attempt, attemptNumber };
  });
  if (!preparedAttempt) return;
  const { batch, attempt, attemptNumber } = preparedAttempt;
  try {
    const messages = await messagesForBatch(campaign, recipients);
    const result = await getEmailProvider().sendBatch(messages, {
      idempotencyKey: batch.idempotencyKey,
    });
    const items = recipients.map((recipient, index) => ({
      id: recipient.id,
      ...(result.items[index] ?? {
        index,
        accepted: false,
        code: "missing_provider_result",
        message: "Provider returned no result",
      }),
    }));
    const accepted = items.filter((item) => item.accepted).length;
    const outcome =
      accepted === items.length ? "ACCEPTED" : accepted ? "PARTIAL" : "PERMANENT_FAILED";
    await prisma.sendAttempt.update({
      where: { id: attempt.id },
      data: {
        outcome,
        completedAt: new Date(),
        providerRequestId: result.providerRequestId,
        responseSummary: {
          accepted,
          failed: items.length - accepted,
          providerIds: items.flatMap((item) =>
            item.providerEmailId ? [item.providerEmailId] : []
          ),
        },
      },
    });
    await finishBatch({
      batchId,
      campaignId: campaign.id,
      senderProfileId: campaign.senderProfileId,
      localDate: usageDate,
      items,
      outcome,
    });
    logger.info(
      {
        event: accepted > 0 ? "batch_accepted" : "batch_completed",
        campaignId: campaign.id,
        batchId,
        attempted: items.length,
        accepted,
        failed: items.length - accepted,
        outcome,
      },
      "Provider batch result committed"
    );
  } catch (error) {
    const failure = classifyProviderFailure({
      status:
        typeof error === "object" && error && "status" in error ? Number(error.status) : undefined,
      code: typeof error === "object" && error && "code" in error ? String(error.code) : undefined,
      timedOutAfterSubmit:
        typeof error === "object" && error && "timedOutAfterSubmit" in error
          ? Boolean(error.timedOutAfterSubmit)
          : false,
    });
    const message = sanitizeErrorMessage(error);
    const retryable =
      failure === "temporary" && canRetry(attemptNumber, 4, batch.idempotencyExpiresAt);
    const status = retryable
      ? "TEMPORARY_FAILED"
      : failure === "uncertain"
        ? "MANUAL_REVIEW"
        : "PERMANENT_FAILED";
    await prisma.$transaction(async (tx) => {
      await tx.sendAttempt.update({
        where: { id: attempt.id },
        data: {
          outcome:
            failure === "uncertain"
              ? "UNCERTAIN"
              : failure === "temporary"
                ? "TEMPORARY_FAILED"
                : "PERMANENT_FAILED",
          completedAt: new Date(),
          errorCode: failure,
          errorMessage: message,
        },
      });
      await tx.sendBatch.update({
        where: { id: batchId },
        data: {
          status,
          lastErrorCode: failure,
          lastErrorMessage: message,
          nextAttemptAt: retryable ? new Date(Date.now() + retryDelayMs(attemptNumber)) : null,
        },
      });
      await tx.campaignRecipient.updateMany({
        where: { sendBatchId: batchId },
        data: {
          sendState: retryable
            ? "TEMPORARY_FAILED"
            : status === "MANUAL_REVIEW"
              ? "MANUAL_REVIEW"
              : "PERMANENT_FAILED",
          lastErrorCode: failure,
          lastErrorMessage: message,
          attemptCount: { increment: 1 },
        },
      });
      if (!retryable && status !== "MANUAL_REVIEW") {
        await tx.senderDailyUsage.update({
          where: {
            senderProfileId_localDate: {
              senderProfileId: campaign.senderProfileId,
              localDate: usageDate,
            },
          },
          data: {
            reservedCount: { decrement: recipients.length },
            releasedCount: { increment: recipients.length },
          },
        });
      }
    });
    if (retryable)
      await scheduleDispatch(
        campaign.id,
        new Date(Date.now() + retryDelayMs(attemptNumber)),
        `retry-${batchId}-${attemptNumber}`,
        batchId
      );
    logger.warn(
      {
        event: "batch_failed",
        campaignId: campaign.id,
        batchId,
        attempted: recipients.length,
        failure,
        retryable,
        status,
      },
      "Provider batch failed"
    );
  }
}

async function loadCampaign(id: string) {
  return prisma.campaign.findUnique({ where: { id }, include: { senderProfile: true } });
}

export async function executeReservedBatch(campaignId: string, batchId: string): Promise<void> {
  const prepared = await inTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM campaigns WHERE id = ${campaignId}::uuid FOR UPDATE
    `;
    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      include: { senderProfile: true },
    });
    if (
      !campaign ||
      ["PAUSED", "CANCELLED", "COMPLETED", "FAILED"].includes(campaign.status) ||
      !campaign.senderProfile.isActive ||
      campaign.senderProfile.verificationStatus !== "VERIFIED"
    )
      return null;

    const current = await tx.sendBatch.findUnique({ where: { id: batchId } });
    if (!current || current.campaignId !== campaignId) return null;
    if (current.status === "TEMPORARY_FAILED") {
      const claimed = await tx.sendBatch.updateMany({
        where: { id: batchId, status: "TEMPORARY_FAILED" },
        data: { status: "PREPARING", nextAttemptAt: null },
      });
      if (claimed.count !== 1) return null;
      await tx.campaignRecipient.updateMany({
        where: { sendBatchId: batchId, sendState: "TEMPORARY_FAILED" },
        data: { sendState: "SENDING" },
      });
    } else if (current.status !== "PREPARING") {
      return null;
    }

    const batch = await tx.sendBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { recipients: { where: { sendState: "SENDING" } } },
    });
    if (batch.recipients.length === 0) return null;
    return { campaign, batch };
  });
  if (!prepared) return;
  const { campaign, batch } = prepared;
  await executeBatch(
    campaign,
    batch.id,
    batch.recipients,
    localDate(batch.createdAt, campaign.senderProfile.timezone)
  );
}

export async function dispatchCampaign(payload: DispatchPayload): Promise<void> {
  const campaign = await loadCampaign(payload.campaignId);
  const terminalStatuses: CampaignStatus[] = [
    CampaignStatus.PAUSED,
    CampaignStatus.CANCELLED,
    CampaignStatus.COMPLETED,
    CampaignStatus.FAILED,
  ];
  if (!campaign || terminalStatuses.includes(campaign.status)) return;
  if (config.deliveryMode === "disabled") {
    const retryAt = new Date(Date.now() + 5 * 60_000);
    // Keep a durable wake-up while delivery is disabled. The currently running
    // job will be marked complete by JobRunner, so the hold job needs its own
    // immutable key instead of updating the job that is executing.
    await scheduleDispatch(campaign.id, retryAt, `disabled-${retryAt.toISOString()}`);
    return;
  }
  const [globalPause, recoveryGuard] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "GLOBAL_SEND_PAUSED" } }),
    prisma.systemSetting.findUnique({ where: { key: "RECOVERY_GUARD" } }),
  ]);
  const recoveryRequired =
    recoveryGuard?.value &&
    typeof recoveryGuard.value === "object" &&
    !Array.isArray(recoveryGuard.value) &&
    "required" in recoveryGuard.value &&
    recoveryGuard.value.required === true;
  if (globalPause?.value === true || recoveryRequired) {
    await scheduleDispatch(campaign.id, new Date(Date.now() + 5 * 60_000), `paused-${Date.now()}`);
    return;
  }
  if (
    !isInsideSendWindow(
      new Date(),
      campaign.senderProfile.timezone,
      campaign.senderProfile.sendWindowStart,
      campaign.senderProfile.sendWindowEnd,
      campaign.senderProfile.allowedWeekdays
    )
  ) {
    const nextWindow = nextSendWindow(
      new Date(),
      campaign.senderProfile.timezone,
      campaign.senderProfile.sendWindowStart,
      campaign.senderProfile.sendWindowEnd,
      campaign.senderProfile.allowedWeekdays
    );
    await scheduleDispatch(campaign.id, nextWindow, `window-${nextWindow.toISOString()}`);
    return;
  }
  if (payload.sendBatchId) {
    await executeReservedBatch(campaign.id, payload.sendBatchId);
    return;
  }
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "SENDING", startedAt: campaign.startedAt ?? new Date() },
  });
  await prisma.$executeRaw(Prisma.sql`
    UPDATE campaign_recipients cr
    SET send_state = 'SUPPRESSED'::"RecipientSendState",
        suppression_reason = s.reason,
        updated_at = now()
    FROM suppressions s
    WHERE cr.campaign_id = ${campaign.id}::uuid
      AND cr.send_state = 'PENDING'::"RecipientSendState"
      AND s.email_normalized = cr.email_normalized
      AND s.is_active
  `);
  if (config.deliveryMode === "sandbox") {
    await prisma.campaignRecipient.updateMany({
      where: {
        campaignId: campaign.id,
        sendState: { in: ["PENDING", "TEMPORARY_FAILED"] },
        emailNormalized: { notIn: config.testAllowlist },
      },
      data: {
        sendState: "PERMANENT_FAILED",
        lastErrorCode: "sandbox_recipient_denied",
        lastErrorMessage: "Recipient is not in EMAIL_TEST_ALLOWLIST",
      },
    });
  }
  const limit = effectiveDailyLimit({
    dailyLimit: campaign.senderProfile.dailyLimit,
    warmupEnabled: campaign.senderProfile.warmupEnabled,
    warmupStartDate: campaign.senderProfile.warmupStartDate,
    warmupSchedule: parseWarmup(campaign.senderProfile.warmupSchedule),
    now: new Date(),
    timezone: campaign.senderProfile.timezone,
  });
  const usageDate = localDate(new Date(), campaign.senderProfile.timezone);
  const claimed = await reserveCampaignRecipients({
    campaignId: campaign.id,
    senderProfileId: campaign.senderProfileId,
    localDate: usageDate,
    timezone: campaign.senderProfile.timezone,
    effectiveLimit: limit,
    requested: Math.min(100, campaign.senderProfile.batchSize),
  });
  if (claimed) {
    const recipients = await prisma.campaignRecipient.findMany({
      where: { id: { in: claimed.recipients.map((item) => item.id) } },
      orderBy: { createdAt: "asc" },
    });
    await executeBatch(campaign, claimed.batchId, recipients, usageDate);
    await scheduleDispatch(
      campaign.id,
      new Date(Date.now() + campaign.senderProfile.minBatchIntervalSeconds * 1000),
      `next-${claimed.batchId}`
    );
  }
  const remaining = await prisma.campaignRecipient.count({
    where: {
      campaignId: campaign.id,
      sendState: { in: ["PENDING", "RESERVED", "SENDING", "TEMPORARY_FAILED"] },
    },
  });
  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await recomputeCampaignStats(campaign.id);
    logger.info(
      { event: "campaign_completed", campaignId: campaign.id },
      "Campaign delivery completed"
    );
  } else if (!claimed) {
    const nextWindow = nextSendWindow(
      new Date(),
      campaign.senderProfile.timezone,
      campaign.senderProfile.sendWindowStart,
      campaign.senderProfile.sendWindowEnd,
      campaign.senderProfile.allowedWeekdays
    );
    await scheduleDispatch(campaign.id, nextWindow, `quota-${usageDate.toISOString()}`);
  }
}
