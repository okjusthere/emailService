import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipientReportingGroup } from "../../src/modules/analytics/reporting.js";

const fake = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../../src/db/prisma.js", () => {
  const tx = {
    campaign: { findUnique: fake.findUnique, updateMany: fake.updateMany },
    $queryRaw: fake.query,
    $executeRaw: fake.execute,
  };
  return {
    prisma: {
      campaign: { findMany: fake.findMany },
      $transaction: (fn: (db: typeof tx) => unknown) => fn(tx),
      $disconnect: fake.disconnect,
    },
  };
});

const id = "285f303e-a6f3-427b-8bfa-d84072b8c3cf";
const originalUpdatedAt = new Date("2026-08-22T14:00:00Z");
const facts: RecipientReportingGroup = {
  count: 100,
  sendState: "ACCEPTED",
  deliveryState: "COMPLAINED",
  accepted: true,
  delivered: true,
  bounced: true,
  providerSuppressed: false,
  opened: false,
  clicked: false,
  listingClicked: false,
  clickTrackingEnabled: null,
  openTrackingEnabled: null,
  firstAcceptedAt: new Date("2026-08-22T13:00:00Z"),
  bounceType: "Permanent",
  suppressionReason: null,
};
const originalArgs = process.argv;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  fake.findMany.mockResolvedValueOnce([{ id }]).mockResolvedValueOnce([]);
  fake.findUnique.mockResolvedValue({ statsComputedAt: null, updatedAt: originalUpdatedAt });
  fake.query.mockResolvedValue([facts]);
  fake.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => {
  process.argv = originalArgs;
  vi.restoreAllMocks();
});

describe("reporting rollout is isolated from delivery guards and tracking history", () => {
  it("defaults to a database read-only transaction even for 100% bounce/complaint history", async () => {
    process.argv = ["node", "backfill-campaign-reporting.ts"];
    await import("../../scripts/backfill-campaign-reporting.js");
    expect(fake.execute).toHaveBeenCalledOnce();
    expect(fake.execute.mock.calls[0]?.[0]).toEqual(["SET TRANSACTION READ ONLY"]);
    expect(fake.updateMany).not.toHaveBeenCalled();
    expect(fake.disconnect).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('"updated":0'));
  });

  it("writes only derived reporting and preserves campaign order, statuses and unknown history", async () => {
    process.argv = ["node", "backfill-campaign-reporting.ts", "--apply"];
    await import("../../scripts/backfill-campaign-reporting.js");
    expect(fake.execute).not.toHaveBeenCalled();
    expect(fake.updateMany).toHaveBeenCalledOnce();
    const update = fake.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toEqual({ id, statsComputedAt: null, updatedAt: originalUpdatedAt });
    expect(Object.keys(update.data).sort()).toEqual(
      [
        "targetCount",
        "eligibleCount",
        "suppressedCount",
        "acceptedCount",
        "deliveredCount",
        "openedCount",
        "clickedCount",
        "bouncedCount",
        "complainedCount",
        "failedCount",
        "reportingSummary",
        "statsComputedAt",
        "updatedAt",
      ].sort()
    );
    expect(update.data).toMatchObject({
      updatedAt: originalUpdatedAt,
      bouncedCount: 100,
      complainedCount: 100,
      reportingSummary: {
        clicks: { availability: "unknown", count: null },
        delivery: { acceptedCount: 100, deliveredCount: 0, undeliveredCount: 100 },
      },
    });
  });

  it("reports concurrent changes as skipped so a rerun cannot overwrite a newer report", async () => {
    fake.updateMany.mockResolvedValue({ count: 0 });
    process.argv = ["node", "backfill-campaign-reporting.ts", "--apply"];
    await import("../../scripts/backfill-campaign-reporting.js");
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('"skippedConcurrent":1'));
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('"updated":0'));
  });
});
