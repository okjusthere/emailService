import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import {
  buildCampaignReporting,
  buildLegacyStats,
  type RecipientReportingGroup,
} from "./reporting.js";

/** Guard-free read shared by event recomputation and the reporting migration. */
export async function readCampaignStats(
  campaignId: string,
  db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma
) {
  // Group facts in PostgreSQL so large audiences do not load one object per recipient.
  // ACCEPTED is a compatibility fallback for imported rows without accepted_at.
  const groups = await db.$queryRaw<RecipientReportingGroup[]>(Prisma.sql`
    WITH facts AS (
      SELECT
        send_state AS "sendState",
        delivery_state AS "deliveryState",
        (accepted_at IS NOT NULL OR send_state = 'ACCEPTED'::"RecipientSendState") AS accepted,
        (delivered_at IS NOT NULL) AS delivered,
        (bounced_at IS NOT NULL OR delivery_state = 'BOUNCED'::"RecipientDeliveryState") AS bounced,
        (provider_suppressed_at IS NOT NULL OR delivery_state = 'PROVIDER_SUPPRESSED'::"RecipientDeliveryState") AS "providerSuppressed",
        (opened_at IS NOT NULL) AS opened,
        (clicked_at IS NOT NULL) AS clicked,
        (listing_clicked_at IS NOT NULL) AS "listingClicked",
        click_tracking_enabled AS "clickTrackingEnabled",
        open_tracking_enabled AS "openTrackingEnabled",
        bounce_type AS "bounceType",
        suppression_reason AS "suppressionReason",
        accepted_at
      FROM campaign_recipients
      WHERE campaign_id = ${campaignId}::uuid
    )
    SELECT
      "sendState", "deliveryState", accepted, delivered, bounced, "providerSuppressed",
      opened, clicked, "listingClicked", "clickTrackingEnabled", "openTrackingEnabled",
      "bounceType", "suppressionReason",
      COUNT(*)::int AS count, MIN(accepted_at) AS "firstAcceptedAt"
    FROM facts
    GROUP BY "sendState", "deliveryState", accepted, delivered, bounced, "providerSuppressed",
      opened, clicked, "listingClicked", "clickTrackingEnabled", "openTrackingEnabled",
      "bounceType", "suppressionReason"
  `);
  const stats = buildLegacyStats(groups);
  const computedAt = new Date();
  const reporting = buildCampaignReporting(groups, computedAt);
  return { stats, reporting, computedAt };
}

/** Only derived campaign values; no lifecycle, sender or tracking configuration mutation. */
export function campaignStatsUpdate(snapshot: Awaited<ReturnType<typeof readCampaignStats>>) {
  const {
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
  } = snapshot.stats;
  return {
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
    reportingSummary: snapshot.reporting as unknown as Prisma.InputJsonValue,
    statsComputedAt: snapshot.computedAt,
  };
}
