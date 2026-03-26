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
 * Default drip send settings.
 * - chunkSize: how many emails per chunk
 * - spreadHours: distribute chunks over this many hours
 */
const DEFAULT_CHUNK_SIZE = 50;
const DEFAULT_SPREAD_HOURS = 4;

export interface WarmupInfo {
  /** Max emails allowed today */
  limit: number;
  /** Current warmup day (1-14), or null if past warmup */
  warmupDay: number | null;
  /** Whether still in warmup period */
  isWarmingUp: boolean;
}

export interface DripConfig {
  /** Emails per chunk */
  chunkSize: number;
  /** Minutes between chunks */
  intervalMinutes: number;
  /** Max emails today (warmup-aware) */
  dailyLimit: number;
  /** Warmup info */
  warmup: WarmupInfo;
}

/**
 * Get the effective daily send limit based on warmup schedule.
 */
export function getEffectiveDailyLimit(): WarmupInfo {
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

/**
 * Get drip send configuration.
 * Automatically calculates chunk interval based on warmup day and total volume.
 *
 * Strategy:
 *  - During warmup: spread evenly over DEFAULT_SPREAD_HOURS hours
 *  - After warmup: use a comfortable interval (higher throughput)
 */
export function getDripConfig(overrides?: {
  chunkSize?: number;
  intervalMinutes?: number;
}): DripConfig {
  const warmup = getEffectiveDailyLimit();
  const chunkSize = overrides?.chunkSize || DEFAULT_CHUNK_SIZE;

  if (overrides?.intervalMinutes) {
    // User explicitly set interval
    return {
      chunkSize,
      intervalMinutes: overrides.intervalMinutes,
      dailyLimit: warmup.limit,
      warmup,
    };
  }

  // Auto-calculate: spread chunks evenly over SPREAD_HOURS
  const totalChunks = Math.ceil(warmup.limit / chunkSize);
  const spreadMinutes = DEFAULT_SPREAD_HOURS * 60;
  const intervalMinutes = totalChunks > 1
    ? Math.max(1, Math.floor(spreadMinutes / totalChunks))
    : 1;

  logger.info(
    `Drip config: ${chunkSize} emails/chunk, ${intervalMinutes}min interval, ` +
    `${totalChunks} chunks over ~${DEFAULT_SPREAD_HOURS}h (limit: ${warmup.limit}/day)`
  );

  return {
    chunkSize,
    intervalMinutes,
    dailyLimit: warmup.limit,
    warmup,
  };
}
