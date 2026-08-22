import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../shared/logger.js";

function numericThreshold(
  value: unknown,
  key: "minSampleSize" | "complaintRate" | "bounceRate",
  fallback: number
): number {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !(key in value))
    return fallback;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
}

export async function recomputeCampaignStats(campaignId: string) {
  const [counts] = await prisma.$queryRaw<
    Array<{
      target_count: number;
      eligible_count: number;
      suppressed_count: number;
      accepted_count: number;
      delivered_count: number;
      opened_count: number;
      clicked_count: number;
      bounced_count: number;
      complained_count: number;
      failed_count: number;
      manual_review_count: number;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS target_count,
      COUNT(*) FILTER (WHERE send_state <> 'SUPPRESSED'::"RecipientSendState")::int AS eligible_count,
      COUNT(*) FILTER (WHERE send_state = 'SUPPRESSED'::"RecipientSendState")::int AS suppressed_count,
      COUNT(*) FILTER (WHERE send_state = 'ACCEPTED'::"RecipientSendState")::int AS accepted_count,
      COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered_count,
      COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened_count,
      COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicked_count,
      COUNT(*) FILTER (WHERE delivery_state = 'BOUNCED'::"RecipientDeliveryState")::int AS bounced_count,
      COUNT(*) FILTER (WHERE delivery_state = 'COMPLAINED'::"RecipientDeliveryState")::int AS complained_count,
      COUNT(*) FILTER (WHERE send_state = 'PERMANENT_FAILED'::"RecipientSendState")::int AS failed_count,
      COUNT(*) FILTER (WHERE send_state = 'MANUAL_REVIEW'::"RecipientSendState")::int AS manual_review_count
    FROM campaign_recipients
    WHERE campaign_id = ${campaignId}::uuid
  `);
  const {
    target_count: targetCount = 0,
    eligible_count: eligibleCount = 0,
    suppressed_count: suppressedCount = 0,
    accepted_count: acceptedCount = 0,
    delivered_count: deliveredCount = 0,
    opened_count: openedCount = 0,
    clicked_count: clickedCount = 0,
    bounced_count: bouncedCount = 0,
    complained_count: complainedCount = 0,
    failed_count: failedCount = 0,
    manual_review_count: manualReviewCount = 0,
  } = counts ?? ({} as Record<string, never>);
  const stats = {
    targetCount,
    eligibleCount,
    suppressedCount,
    acceptedCount,
    deliveredCount,
    openedCount,
    clickedCount,
    bouncedCount,
    complainedCount,
    failedCount,
    manualReviewCount,
    deliveryRate: acceptedCount ? deliveredCount / acceptedCount : 0,
    openRate: deliveredCount ? openedCount / deliveredCount : 0,
    clickRate: deliveredCount ? clickedCount / deliveredCount : 0,
    bounceRate: acceptedCount ? bouncedCount / acceptedCount : 0,
    complaintRate: acceptedCount ? complainedCount / acceptedCount : 0,
  };
  const thresholdSetting = await prisma.systemSetting.findUnique({
    where: { key: "DELIVERABILITY_THRESHOLDS" },
  });
  const minSampleSize = numericThreshold(thresholdSetting?.value, "minSampleSize", 100);
  const complaintThreshold = numericThreshold(thresholdSetting?.value, "complaintRate", 0.001);
  const bounceThreshold = numericThreshold(thresholdSetting?.value, "bounceRate", 0.05);
  const thresholdExceeded =
    acceptedCount >= minSampleSize &&
    (stats.complaintRate >= complaintThreshold || stats.bounceRate >= bounceThreshold);
  await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.update({
      where: { id: campaignId },
      data: {
        targetCount,
        eligibleCount,
        suppressedCount,
        acceptedCount,
        deliveredCount,
        openedCount,
        clickedCount,
        bouncedCount,
        complainedCount,
        failedCount,
      },
      select: { senderProfileId: true },
    });
    if (thresholdExceeded) {
      await tx.campaign.updateMany({
        where: { id: campaignId, status: { in: ["QUEUED", "SCHEDULED", "SENDING"] } },
        data: { status: "PAUSED" },
      });
      await tx.senderProfile.update({
        where: { id: campaign.senderProfileId },
        data: { verificationStatus: "SUSPENDED" },
      });
      await tx.systemSetting.upsert({
        where: { key: "DELIVERABILITY_ALERT" },
        create: {
          key: "DELIVERABILITY_ALERT",
          value: {
            actionRequired: true,
            campaignId,
            senderProfileId: campaign.senderProfileId,
            complaintRate: stats.complaintRate,
            bounceRate: stats.bounceRate,
            at: new Date().toISOString(),
          },
        },
        update: {
          value: {
            actionRequired: true,
            campaignId,
            senderProfileId: campaign.senderProfileId,
            complaintRate: stats.complaintRate,
            bounceRate: stats.bounceRate,
            at: new Date().toISOString(),
          },
        },
      });
    }
  });
  if (thresholdExceeded)
    logger.warn(
      {
        event: "deliverability_threshold_exceeded",
        campaignId,
        complaintRate: stats.complaintRate,
        bounceRate: stats.bounceRate,
      },
      "Campaign paused and sender suspended by deliverability guard"
    );
  return stats;
}

export async function dashboardSummary() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [
    activeListings,
    contacts,
    suppressed,
    campaigns,
    accepted,
    delivered,
    clicked,
    manualReview,
  ] = await Promise.all([
    prisma.listing.count({ where: { status: "ACTIVE" } }),
    prisma.contact.count({ where: { status: "ACTIVE" } }),
    prisma.suppression.count({ where: { isActive: true } }),
    prisma.campaign.count({ where: { startedAt: { gte: since } } }),
    prisma.campaignRecipient.count({ where: { acceptedAt: { gte: since } } }),
    prisma.campaignRecipient.count({ where: { deliveredAt: { gte: since } } }),
    prisma.campaignRecipient.count({ where: { clickedAt: { gte: since } } }),
    prisma.sendBatch.count({ where: { status: "MANUAL_REVIEW" } }),
  ]);
  return {
    activeListings,
    contacts,
    eligibleContacts: Math.max(0, contacts - suppressed),
    suppressed,
    campaignsLast30Days: campaigns,
    accepted,
    delivered,
    clicked,
    manualReview,
  };
}
