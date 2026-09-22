import type { RecipientDeliveryState, RecipientSendState } from "@prisma/client";

/** Grouped recipient facts, never the sender's current tracking preference. */
export interface RecipientReportingGroup {
  count: number;
  sendState: RecipientSendState;
  deliveryState: RecipientDeliveryState;
  accepted: boolean;
  delivered: boolean;
  bounced: boolean;
  providerSuppressed: boolean;
  opened: boolean;
  clicked: boolean;
  listingClicked: boolean;
  clickTrackingEnabled: boolean | null;
  openTrackingEnabled: boolean | null;
  firstAcceptedAt: Date | null;
  bounceType: string | null;
  suppressionReason: string | null;
}

export interface EngagementReporting {
  availability: "disabled" | "unknown" | "active" | "partial";
  count: number | null;
  /** Unique engaged AND delivered recipients / delivered recipients in the same tracked cohort. */
  rate: number | null;
  coverageSentCount: number;
  coverageDeliveredCount: number;
  untrackedSentCount: number;
  unknownSentCount: number;
  startedAt: string | null;
  asOf: string;
}

export interface CampaignReporting {
  version: 1;
  asOf: string;
  delivery: {
    targetCount: number;
    acceptedCount: number;
    deliveredCount: number;
    pendingCount: number;
    undeliveredCount: number;
    pendingSendCount: number;
    failedBeforeSendCount: number;
    excludedCount: number;
    cancelledCount: number;
    manualReviewCount: number;
    bounce: { permanentCount: number; transientCount: number; undeterminedCount: number };
    suppressionReasons: Array<{ reason: string; count: number }>;
  };
  clicks: EngagementReporting;
  opens: EngagementReporting;
}

function engagement(
  groups: RecipientReportingGroup[],
  kind: "clicks" | "opens",
  asOf: string
): EngagementReporting {
  let accepted = 0;
  let covered = 0;
  let delivered = 0;
  let disabled = 0;
  let unknown = 0;
  let engaged = 0;
  let engagedDelivered = 0;
  let startedAt: Date | null = null;
  for (const group of groups) {
    if (!group.accepted) continue;
    accepted += group.count;
    const enabled = kind === "clicks" ? group.clickTrackingEnabled : group.openTrackingEnabled;
    if (enabled === false) {
      disabled += group.count;
      continue;
    }
    if (enabled !== true) {
      unknown += group.count;
      continue;
    }
    covered += group.count;
    if (group.delivered) delivered += group.count;
    if (kind === "clicks" ? group.listingClicked : group.opened) {
      engaged += group.count;
      if (group.delivered) engagedDelivered += group.count;
    }
    if (group.firstAcceptedAt && (!startedAt || group.firstAcceptedAt < startedAt))
      startedAt = group.firstAcceptedAt;
  }
  const availability = covered
    ? covered === accepted
      ? "active"
      : "partial"
    : accepted > 0 && disabled === accepted
      ? "disabled"
      : "unknown";
  return {
    availability,
    count: covered ? engaged : null,
    rate: delivered ? engagedDelivered / delivered : null,
    coverageSentCount: covered,
    coverageDeliveredCount: delivered,
    untrackedSentCount: disabled,
    unknownSentCount: unknown,
    startedAt: startedAt?.toISOString() ?? null,
    asOf,
  };
}

/** Current delivery outcomes are disjoint; historical delivery receipts remain engagement facts. */
export function buildCampaignReporting(
  groups: RecipientReportingGroup[],
  computedAt: Date
): CampaignReporting {
  const asOf = computedAt.toISOString();
  const delivery: CampaignReporting["delivery"] = {
    targetCount: 0,
    acceptedCount: 0,
    deliveredCount: 0,
    pendingCount: 0,
    undeliveredCount: 0,
    pendingSendCount: 0,
    failedBeforeSendCount: 0,
    excludedCount: 0,
    cancelledCount: 0,
    manualReviewCount: 0,
    bounce: { permanentCount: 0, transientCount: 0, undeterminedCount: 0 },
    suppressionReasons: [],
  };
  const reasons = new Map<string, number>();
  for (const group of groups) {
    delivery.targetCount += group.count;
    if (group.accepted) {
      delivery.acceptedCount += group.count;
      if (group.bounced || group.providerSuppressed || group.sendState === "PERMANENT_FAILED") {
        delivery.undeliveredCount += group.count;
      } else if (group.delivered) {
        delivery.deliveredCount += group.count;
      } else {
        delivery.pendingCount += group.count;
      }
      if (group.bounced) {
        switch (group.bounceType?.toLowerCase()) {
          case "permanent":
            delivery.bounce.permanentCount += group.count;
            break;
          case "transient":
            delivery.bounce.transientCount += group.count;
            break;
          default:
            delivery.bounce.undeterminedCount += group.count;
        }
      }
    } else if (group.sendState === "PERMANENT_FAILED") {
      delivery.failedBeforeSendCount += group.count;
    } else if (group.sendState === "SUPPRESSED") {
      delivery.excludedCount += group.count;
      const reason = group.suppressionReason ?? "UNKNOWN";
      reasons.set(reason, (reasons.get(reason) ?? 0) + group.count);
    } else if (group.sendState === "CANCELLED") {
      delivery.cancelledCount += group.count;
    } else if (group.sendState === "MANUAL_REVIEW") {
      delivery.manualReviewCount += group.count;
    } else {
      delivery.pendingSendCount += group.count;
    }
  }
  delivery.suppressionReasons = [...reasons]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => ({ reason, count }));
  return {
    version: 1,
    asOf,
    delivery,
    clicks: engagement(groups, "clicks", asOf),
    opens: engagement(groups, "opens", asOf),
  };
}

/** Compatibility aggregates retain their original event-based meanings. */
export function buildLegacyStats(groups: RecipientReportingGroup[]) {
  const counts = {
    targetCount: 0,
    eligibleCount: 0,
    suppressedCount: 0,
    acceptedCount: 0,
    deliveredCount: 0,
    openedCount: 0,
    clickedCount: 0,
    bouncedCount: 0,
    complainedCount: 0,
    failedCount: 0,
    manualReviewCount: 0,
  };
  for (const group of groups) {
    counts.targetCount += group.count;
    if (group.sendState === "SUPPRESSED") counts.suppressedCount += group.count;
    else counts.eligibleCount += group.count;
    if (group.accepted) counts.acceptedCount += group.count;
    if (group.delivered) counts.deliveredCount += group.count;
    if (group.opened) counts.openedCount += group.count;
    if (group.clicked) counts.clickedCount += group.count;
    if (group.bounced) counts.bouncedCount += group.count;
    if (group.deliveryState === "COMPLAINED") counts.complainedCount += group.count;
    if (group.sendState === "PERMANENT_FAILED") counts.failedCount += group.count;
    if (group.sendState === "MANUAL_REVIEW") counts.manualReviewCount += group.count;
  }
  return {
    ...counts,
    deliveryRate: counts.acceptedCount ? counts.deliveredCount / counts.acceptedCount : 0,
    openRate: counts.deliveredCount ? counts.openedCount / counts.deliveredCount : 0,
    clickRate: counts.deliveredCount ? counts.clickedCount / counts.deliveredCount : 0,
    bounceRate: counts.acceptedCount ? counts.bouncedCount / counts.acceptedCount : 0,
    complaintRate: counts.acceptedCount ? counts.complainedCount / counts.acceptedCount : 0,
  };
}
