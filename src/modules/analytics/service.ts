import { prisma } from "../../db/prisma.js";
import { logger } from "../../shared/logger.js";
import { campaignStatsUpdate, readCampaignStats } from "./snapshot.js";

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
  const snapshot = await readCampaignStats(campaignId);
  const { stats, reporting } = snapshot;
  const { acceptedCount } = stats;
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
      data: campaignStatsUpdate(snapshot),
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
  return { ...stats, reporting };
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
