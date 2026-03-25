import { config } from "../config.js";
import { logger } from "./logger.js";

/**
 * IP Warmup Schedule
 * Gradually increases daily send volume over 14 days for new domains/IPs.
 * This prevents spam filters from flagging your emails.
 */
const WARMUP_SCHEDULE: Record<number, number> = {
  1: 200,
  2: 400,
  3: 600,
  4: 1000,
  5: 1500,
  6: 2000,
  7: 2500,
  8: 3000,
  9: 3500,
  10: 4000,
  11: 4500,
  12: 5000,
  13: 5000,
  14: 5000,
};

/**
 * Get the effective daily send limit based on warmup schedule.
 * If SEND_START_DATE is not set, returns the configured dailySendCount.
 * If the domain has been active for 14+ days, returns dailySendCount.
 */
export function getEffectiveDailyLimit(): {
  limit: number;
  warmupDay: number | null;
  isWarmingUp: boolean;
} {
  if (!config.sendStartDate) {
    return { limit: config.dailySendCount, warmupDay: null, isWarmingUp: false };
  }

  const startDate = new Date(config.sendStartDate);
  const now = new Date();
  const daysSinceStart = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1; // Day 1 = first day

  if (daysSinceStart > 14) {
    return { limit: config.dailySendCount, warmupDay: null, isWarmingUp: false };
  }

  const warmupLimit = WARMUP_SCHEDULE[daysSinceStart] || 200;
  const effectiveLimit = Math.min(warmupLimit, config.dailySendCount);

  logger.info(
    `IP Warmup Day ${daysSinceStart}/14: limit = ${effectiveLimit} emails`
  );

  return {
    limit: effectiveLimit,
    warmupDay: daysSinceStart,
    isWarmingUp: true,
  };
}
