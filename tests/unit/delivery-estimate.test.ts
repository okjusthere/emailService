import { describe, expect, it } from "vitest";
import {
  estimateGradualDelivery,
  type DeliveryPacing,
} from "../../client/src/features/composer/deliveryEstimate.js";

const pacing: DeliveryPacing = {
  dailyLimit: 80,
  batchSize: 1,
  minBatchIntervalSeconds: 300,
  timezone: "America/New_York",
  sendWindowStart: "09:30",
  sendWindowEnd: "16:30",
  allowedWeekdays: [1, 2, 3, 4, 5],
  warmupEnabled: true,
  warmupStartDate: "2026-08-24T00:00:00.000Z",
  warmupSchedule: [
    { day: 1, limit: 30 },
    { day: 3, limit: 50 },
    { day: 5, limit: 80 },
  ],
};

describe("gradual delivery estimate", () => {
  it("accounts for the sender-wide cadence, weekday window, and warm-up", () => {
    expect(estimateGradualDelivery(481, pacing, new Date("2026-08-24T13:00:00.000Z"))).toEqual({
      businessDays: 9,
      cadence: "1 email every 5 minutes",
      currentDailyMaximum: 30,
      dailyMaximum: 80,
      warmup: true,
    });
  });

  it("uses the normal daily ceiling after warm-up is disabled", () => {
    expect(
      estimateGradualDelivery(
        481,
        { ...pacing, warmupEnabled: false },
        new Date("2026-08-24T13:00:00.000Z")
      )
    ).toMatchObject({
      businessDays: 7,
      currentDailyMaximum: 80,
      dailyMaximum: 80,
      warmup: false,
    });
  });

  it("uses singular wording for a one-minute interval", () => {
    expect(
      estimateGradualDelivery(20, {
        ...pacing,
        batchSize: 20,
        minBatchIntervalSeconds: 60,
        warmupEnabled: false,
      }).cadence
    ).toBe("20 emails every 1 minute");
  });
});
