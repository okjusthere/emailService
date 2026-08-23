import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { inTransaction } from "../../db/transactions.js";
import { DomainError } from "../../shared/errors.js";
import type { ActorContext } from "../audit/service.js";
import { writeAudit } from "../audit/service.js";

export const manualReviewActions = [
  "MARK_ACCEPTED",
  "MARK_NOT_SENT",
  "ATTACH_PROVIDER_ID",
  "SAFE_RETRY",
  "RELEASE_QUOTA",
  "KEEP_IN_REVIEW",
] as const;

export type ManualReviewAction = (typeof manualReviewActions)[number];

export async function listManualReviewBatches() {
  return prisma.sendBatch.findMany({
    where: { status: "MANUAL_REVIEW" },
    include: {
      campaign: { select: { id: true, name: true } },
      senderProfile: { select: { id: true, name: true, timezone: true } },
      recipients: {
        where: { sendState: "MANUAL_REVIEW" },
        select: { id: true, email: true, resendEmailId: true, lastErrorMessage: true },
      },
      attempts: { orderBy: { attemptNumber: "desc" }, take: 3 },
      manualReviewActions: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { updatedAt: "asc" },
  });
}

export async function resolveManualReview(
  batchId: string,
  input: {
    action: ManualReviewAction;
    reason: string;
    providerEmailId?: string;
    recipientId?: string;
  },
  actor: ActorContext
) {
  return inTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM send_batches WHERE id = ${batchId}::uuid FOR UPDATE`;
    const batch = await tx.sendBatch.findUnique({
      where: { id: batchId },
      include: {
        recipients: { where: { sendState: "MANUAL_REVIEW" } },
        senderProfile: true,
        manualReviewActions: true,
      },
    });
    if (!batch) throw new DomainError("MANUAL_REVIEW_NOT_FOUND", "Review batch not found.", 404);
    if (batch.status !== "MANUAL_REVIEW")
      throw new DomainError(
        "MANUAL_REVIEW_ALREADY_RESOLVED",
        "This batch is no longer awaiting manual review.",
        409
      );
    if (input.action === "ATTACH_PROVIDER_ID" && (!input.providerEmailId || !input.recipientId))
      throw new DomainError(
        "PROVIDER_ID_TARGET_REQUIRED",
        "Attaching a provider ID requires a recipient and provider email ID."
      );
    if (input.recipientId && !batch.recipients.some((item) => item.id === input.recipientId))
      throw new DomainError(
        "RECIPIENT_NOT_IN_REVIEW",
        "Recipient is not part of this review.",
        409
      );

    const alreadyReleased = batch.manualReviewActions.reduce(
      (total, item) => total + item.quotaReleased,
      0
    );
    const releasable = Math.max(0, batch.recipients.length - alreadyReleased);
    const releaseQuota = ["MARK_NOT_SENT", "RELEASE_QUOTA"].includes(input.action) ? releasable : 0;
    const acceptedCount =
      input.action === "MARK_ACCEPTED"
        ? batch.recipients.length
        : input.action === "ATTACH_PROVIDER_ID"
          ? 1
          : 0;
    const acceptedFromReleased = Math.min(alreadyReleased, acceptedCount);
    const acceptedFromReserved = acceptedCount - acceptedFromReleased;
    const quotaReleasedAdjustment = releaseQuota - acceptedFromReleased;
    const resolution = await tx.manualReviewResolution.create({
      data: {
        sendBatchId: batch.id,
        action: input.action,
        reason: input.reason.trim(),
        providerEmailId: input.providerEmailId,
        quotaReleased: quotaReleasedAdjustment,
        createdByUserId: actor.userId,
      },
    });

    if (releaseQuota > 0) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE sender_daily_usage
          SET reserved_count = GREATEST(0, reserved_count - ${releaseQuota}),
              released_count = released_count + ${releaseQuota},
              updated_at = NOW()
          WHERE sender_profile_id = ${batch.senderProfileId}::uuid
            AND reserved_count > 0`
      );
    }

    switch (input.action) {
      case "MARK_ACCEPTED":
        await tx.campaignRecipient.updateMany({
          where: { sendBatchId: batch.id, sendState: "MANUAL_REVIEW" },
          data: { sendState: "ACCEPTED", acceptedAt: new Date(), lastErrorCode: null },
        });
        await tx.sendBatch.update({
          where: { id: batch.id },
          data: {
            status: "ACCEPTED",
            acceptedCount: batch.recipients.length,
            failedCount: 0,
            completedAt: new Date(),
          },
        });
        await tx.$executeRaw(
          Prisma.sql`UPDATE sender_daily_usage
            SET reserved_count = GREATEST(0, reserved_count - ${acceptedFromReserved}),
                released_count = GREATEST(0, released_count - ${acceptedFromReleased}),
                accepted_count = accepted_count + ${batch.recipients.length},
                updated_at = NOW()
            WHERE sender_profile_id = ${batch.senderProfileId}::uuid`
        );
        break;
      case "MARK_NOT_SENT":
        await tx.campaignRecipient.updateMany({
          where: { sendBatchId: batch.id, sendState: "MANUAL_REVIEW" },
          data: { sendState: "PERMANENT_FAILED", lastErrorCode: "operator_marked_not_sent" },
        });
        await tx.sendBatch.update({
          where: { id: batch.id },
          data: {
            status: "PERMANENT_FAILED",
            failedCount: batch.recipients.length,
            completedAt: new Date(),
          },
        });
        break;
      case "ATTACH_PROVIDER_ID":
        await tx.campaignRecipient.update({
          where: { id: input.recipientId! },
          data: {
            resendEmailId: input.providerEmailId,
            sendState: "ACCEPTED",
            acceptedAt: new Date(),
            lastErrorCode: null,
          },
        });
        if (batch.recipients.length === 1)
          await tx.sendBatch.update({
            where: { id: batch.id },
            data: { status: "ACCEPTED", acceptedCount: 1, completedAt: new Date() },
          });
        await tx.$executeRaw(
          Prisma.sql`UPDATE sender_daily_usage
            SET reserved_count = GREATEST(0, reserved_count - ${acceptedFromReserved}),
                released_count = GREATEST(0, released_count - ${acceptedFromReleased}),
                accepted_count = accepted_count + 1,
                updated_at = NOW()
            WHERE sender_profile_id = ${batch.senderProfileId}::uuid`
        );
        break;
      case "SAFE_RETRY":
        if (batch.idempotencyExpiresAt <= new Date())
          throw new DomainError(
            "IDEMPOTENCY_WINDOW_EXPIRED",
            "The provider idempotency window expired; keep the batch in review.",
            409
          );
        await tx.sendBatch.update({
          where: { id: batch.id },
          data: { status: "TEMPORARY_FAILED", nextAttemptAt: new Date() },
        });
        await tx.campaignRecipient.updateMany({
          where: { sendBatchId: batch.id, sendState: "MANUAL_REVIEW" },
          data: { sendState: "TEMPORARY_FAILED" },
        });
        await tx.job.create({
          data: {
            type: "DISPATCH_CAMPAIGN",
            uniqueKey: `DISPATCH_CAMPAIGN/${batch.campaignId}/manual-review/${resolution.id}`,
            payload: { campaignId: batch.campaignId, sendBatchId: batch.id },
          },
        });
        break;
      case "RELEASE_QUOTA":
      case "KEEP_IN_REVIEW":
        break;
    }

    await writeAudit(tx, actor, {
      action: `manual_review.${input.action.toLowerCase()}`,
      entityType: "send_batch",
      entityId: batch.id,
      after: {
        reason: input.reason.trim(),
        recipientId: input.recipientId ?? null,
        providerEmailId: input.providerEmailId ?? null,
        quotaReleased: quotaReleasedAdjustment,
      },
    });
    return resolution;
  });
}
