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

  it("bounds an uncapped daily sender by its 08:00–18:00 window", () => {
    expect(
      estimateGradualDelivery(
        1201,
        {
          ...pacing,
          dailyLimit: null,
          minBatchIntervalSeconds: 60,
          sendWindowStart: "08:00",
          sendWindowEnd: "18:00",
          allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
          warmupEnabled: false,
        },
        new Date("2026-08-28T12:00:00.000Z")
      )
    ).toEqual({
      businessDays: 3,
      cadence: "1 email every 1 minute",
      currentDailyMaximum: 600,
      dailyMaximum: 600,
      warmup: false,
    });
  });

  it("preserves optional warm-up limits without a daily cap, including weekend sends", () => {
    expect(
      estimateGradualDelivery(
        61,
        {
          ...pacing,
          dailyLimit: null,
          minBatchIntervalSeconds: 60,
          sendWindowStart: "08:00",
          sendWindowEnd: "18:00",
          allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
          warmupStartDate: "2026-08-28T00:00:00.000Z",
        },
        new Date("2026-08-28T12:00:00.000Z")
      )
    ).toMatchObject({
      businessDays: 3,
      currentDailyMaximum: 30,
      dailyMaximum: 600,
      warmup: true,
    });
  });
});
