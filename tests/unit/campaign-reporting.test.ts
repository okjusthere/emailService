import { describe, expect, it } from "vitest";
import {
  buildCampaignReporting,
  buildLegacyStats,
  type RecipientReportingGroup,
} from "../../src/modules/analytics/reporting.js";
import { buildSendingReporting } from "../../src/modules/analytics/sending.js";

const now = new Date("2026-09-22T14:00:00Z");
function group(overrides: Partial<RecipientReportingGroup> = {}): RecipientReportingGroup {
  return {
    count: 1,
    sendState: "ACCEPTED",
    deliveryState: "DELIVERED",
    accepted: true,
    delivered: true,
    bounced: false,
    providerSuppressed: false,
    opened: false,
    clicked: false,
    listingClicked: false,
    clickTrackingEnabled: null,
    openTrackingEnabled: null,
    firstAcceptedAt: new Date("2026-09-22T13:00:00Z"),
    bounceType: null,
    suppressionReason: null,
    ...overrides,
  };
}

describe("campaign engagement coverage", () => {
  it("distinguishes unknown legacy history, disabled tracking, and a measured zero", () => {
    const unknown = buildCampaignReporting([group()], now);
    expect(unknown.clicks).toMatchObject({ availability: "unknown", count: null, rate: null });
    const disabled = buildCampaignReporting([group({ clickTrackingEnabled: false })], now);
    expect(disabled.clicks).toMatchObject({
      availability: "disabled",
      count: null,
      coverageSentCount: 0,
      untrackedSentCount: 1,
    });
    const active = buildCampaignReporting([group({ clickTrackingEnabled: true })], now);
    expect(active.clicks).toMatchObject({
      availability: "active",
      count: 0,
      rate: 0,
      coverageSentCount: 1,
      coverageDeliveredCount: 1,
    });
    expect(active.opens.availability).toBe("unknown");
  });

  it("does not infer tracking coverage from old events or from an unsent cohort", () => {
    const report = buildCampaignReporting(
      [
        group({ listingClicked: true, clicked: true, opened: true }),
        group({
          accepted: false,
          sendState: "PENDING",
          clickTrackingEnabled: true,
          delivered: false,
          firstAcceptedAt: null,
        }),
      ],
      now
    );
    expect(report.clicks).toMatchObject({ availability: "unknown", count: null, rate: null });
    expect(report.opens.count).toBeNull();
    expect(report.clicks.coverageSentCount).toBe(0);
    expect(buildCampaignReporting([], now).clicks.count).toBeNull();
  });

  it("limits partial rates to the same delivered and tracked cohort", () => {
    const report = buildCampaignReporting(
      [
        group({ count: 100, clickTrackingEnabled: false }),
        group({ count: 50 }),
        group({ count: 8, clickTrackingEnabled: true }),
        group({ count: 2, clickTrackingEnabled: true, listingClicked: true }),
        group({
          count: 3,
          clickTrackingEnabled: true,
          listingClicked: true,
          delivered: false,
          deliveryState: "UNKNOWN",
        }),
      ],
      now
    );
    expect(report.clicks).toEqual({
      availability: "partial",
      count: 5,
      rate: 0.2,
      coverageSentCount: 13,
      coverageDeliveredCount: 10,
      untrackedSentCount: 100,
      unknownSentCount: 50,
      startedAt: "2026-09-22T13:00:00.000Z",
      asOf: now.toISOString(),
    });
  });

  it("preserves clicks before a delivery receipt without inventing a rate or delivery", () => {
    const report = buildCampaignReporting(
      [group({ clickTrackingEnabled: true, listingClicked: true, delivered: false })],
      now
    );
    expect(report.clicks).toMatchObject({ count: 1, rate: null, coverageDeliveredCount: 0 });
    expect(report.delivery).toMatchObject({ deliveredCount: 0, pendingCount: 1 });
  });

  it("does not count generic or unsubscribe clicks as listing engagement", () => {
    const groups = [group({ clickTrackingEnabled: true, clicked: true })];
    expect(buildCampaignReporting(groups, now).clicks.count).toBe(0);
    expect(buildLegacyStats(groups).clickedCount).toBe(1);
  });

  it("calculates opening signals independently of listing clicks", () => {
    const report = buildCampaignReporting(
      [group({ openTrackingEnabled: true, clickTrackingEnabled: false, opened: true })],
      now
    );
    expect(report.opens).toMatchObject({ availability: "active", count: 1, rate: 1 });
    expect(report.clicks.count).toBeNull();
  });
});

describe("disjoint current delivery outcomes", () => {
  it("retains accepted and historical delivery facts after a later failure or bounce", () => {
    const groups = [
      group({ sendState: "PERMANENT_FAILED", clickTrackingEnabled: true, listingClicked: true }),
      group({ deliveryState: "BOUNCED", bounced: true, bounceType: "Permanent" }),
      group({ deliveryState: "COMPLAINED", bounced: true, bounceType: "Transient" }),
      group({ deliveryState: "BOUNCED", bounced: true }),
      group({ deliveryState: "PROVIDER_SUPPRESSED", providerSuppressed: true }),
      group({ deliveryState: "COMPLAINED" }),
      group({ delivered: false, deliveryState: "UNKNOWN" }),
      group(),
    ];
    const report = buildCampaignReporting(groups, now);
    expect(report.delivery).toMatchObject({
      acceptedCount: 8,
      deliveredCount: 2,
      undeliveredCount: 5,
      pendingCount: 1,
      bounce: { permanentCount: 1, transientCount: 1, undeterminedCount: 1 },
    });
    expect(report.clicks).toMatchObject({ coverageDeliveredCount: 1, rate: 1 });
    expect(buildLegacyStats(groups)).toMatchObject({
      acceptedCount: 8,
      deliveredCount: 7,
      failedCount: 1,
      complainedCount: 2,
      bouncedCount: 3,
    });
  });

  it("conserves every target and keeps pre-submission exclusions outside delivery outcomes", () => {
    const groups = [
      group(),
      ...(["PENDING", "RESERVED", "SENDING", "TEMPORARY_FAILED"] as const).map((sendState) =>
        group({ accepted: false, delivered: false, sendState, count: 2 })
      ),
      group({ accepted: false, sendState: "PERMANENT_FAILED", count: 3 }),
      group({ accepted: false, sendState: "SUPPRESSED", suppressionReason: "UNSUBSCRIBE" }),
      group({ accepted: false, sendState: "CANCELLED", count: 4 }),
      group({ accepted: false, sendState: "MANUAL_REVIEW", count: 5 }),
    ];
    const { delivery } = buildCampaignReporting(groups, now);
    expect(delivery).toMatchObject({
      targetCount: 22,
      acceptedCount: 1,
      pendingSendCount: 8,
      failedBeforeSendCount: 3,
      excludedCount: 1,
      cancelledCount: 4,
      manualReviewCount: 5,
      suppressionReasons: [{ reason: "UNSUBSCRIBE", count: 1 }],
    });
    expect(delivery.targetCount).toBe(
      delivery.acceptedCount +
        delivery.pendingSendCount +
        delivery.failedBeforeSendCount +
        delivery.excludedCount +
        delivery.cancelledCount +
        delivery.manualReviewCount
    );
    expect(delivery.acceptedCount).toBe(
      delivery.deliveredCount + delivery.pendingCount + delivery.undeliveredCount
    );
  });
});

const senderProfile = {
  isActive: true,
  verificationStatus: "VERIFIED" as const,
  nextBatchAt: null,
  timezone: "America/New_York",
  sendWindowStart: "08:00",
  sendWindowEnd: "18:00",
  allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
};
describe("sending status is a lower bound rather than a completion promise", () => {
  it("distinguishes an overnight window from an intentional pause", () => {
    const afterHours = new Date("2026-09-22T22:01:00Z");
    const campaign = { status: "SENDING" as const, scheduledAt: null, senderProfile };
    expect(buildSendingReporting(campaign, afterHours)).toEqual({
      state: "waiting_window",
      nextSendAt: "2026-09-23T12:00:00.000Z",
      estimateKind: "earliest_possible",
    });
    expect(buildSendingReporting({ ...campaign, status: "PAUSED" }, afterHours)).toMatchObject({
      state: "paused",
      nextSendAt: null,
    });
  });

  it("takes the shared sender cadence and scheduled start into account", () => {
    const campaign = {
      status: "SCHEDULED" as const,
      scheduledAt: new Date("2026-09-22T15:00:00Z"),
      senderProfile: { ...senderProfile, nextBatchAt: new Date("2026-09-22T15:01:00Z") },
    };
    expect(buildSendingReporting(campaign, now)).toMatchObject({
      state: "scheduled",
      nextSendAt: "2026-09-22T15:01:00.000Z",
    });
    expect(
      buildSendingReporting({ ...campaign, status: "SENDING", scheduledAt: null }, now)
    ).toMatchObject({ state: "waiting_cadence" });
  });

  it("does not promise a send for a blocked sender or a completed campaign", () => {
    expect(
      buildSendingReporting(
        {
          status: "SENDING",
          scheduledAt: null,
          senderProfile: { ...senderProfile, verificationStatus: "SUSPENDED" },
        },
        now
      )
    ).toMatchObject({ state: "blocked", nextSendAt: null });
    expect(
      buildSendingReporting({ status: "COMPLETED", scheduledAt: null, senderProfile }, now)
    ).toMatchObject({ state: "completed", nextSendAt: null });
  });
});
