export type DeliveryPacing = {
  dailyLimit: number;
  batchSize: number;
  minBatchIntervalSeconds: number;
  timezone: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  allowedWeekdays: number[];
  warmupEnabled: boolean;
  warmupStartDate?: string | null;
  warmupSchedule?: Array<{ day: number; limit: number }> | null;
};

function minutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function zonedDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function zonedWeekday(date: Date, timezone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

function warmupLimit(profile: DeliveryPacing, date: Date): number {
  if (!profile.warmupEnabled || !profile.warmupStartDate || !profile.warmupSchedule?.length)
    return profile.dailyLimit;
  const startDateKey = profile.warmupStartDate.slice(0, 10);
  const start = new Date(`${startDateKey}T12:00:00Z`);
  const current = new Date(`${zonedDateKey(date, profile.timezone)}T12:00:00Z`);
  const day = Math.max(1, Math.floor((current.getTime() - start.getTime()) / 86_400_000) + 1);
  let limit =
    [...profile.warmupSchedule].sort((a, b) => a.day - b.day)[0]?.limit ?? profile.dailyLimit;
  for (const entry of profile.warmupSchedule) if (day >= entry.day) limit = entry.limit;
  return Math.min(profile.dailyLimit, limit);
}

export function estimateGradualDelivery(
  recipients: number,
  profile: DeliveryPacing,
  start = new Date()
): {
  businessDays: number;
  cadence: string;
  currentDailyMaximum: number;
  dailyMaximum: number;
  warmup: boolean;
} {
  const windowMinutes = Math.max(
    1,
    minutes(profile.sendWindowEnd) - minutes(profile.sendWindowStart)
  );
  const batchesPerDay =
    Math.floor((windowMinutes * 60 - 1) / Math.max(1, profile.minBatchIntervalSeconds)) + 1;
  const windowCapacity = Math.max(1, batchesPerDay * profile.batchSize);
  let remaining = Math.max(0, recipients);
  let businessDays = 0;
  const cursor = new Date(start);
  cursor.setUTCHours(16, 0, 0, 0);
  const currentDailyMaximum = Math.max(
    1,
    Math.min(profile.dailyLimit, warmupLimit(profile, cursor), windowCapacity)
  );
  for (let day = 0; remaining > 0 && day < 366; day += 1) {
    if (profile.allowedWeekdays.includes(zonedWeekday(cursor, profile.timezone))) {
      remaining -= Math.max(
        1,
        Math.min(profile.dailyLimit, warmupLimit(profile, cursor), windowCapacity)
      );
      businessDays += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const intervalMinutes = Math.max(1, Math.round(profile.minBatchIntervalSeconds / 60));
  const batchLabel =
    profile.batchSize === 1 ? "1 email" : `${profile.batchSize.toLocaleString()} emails`;
  return {
    businessDays,
    cadence: `${batchLabel} every ${intervalMinutes} ${intervalMinutes === 1 ? "minute" : "minutes"}`,
    currentDailyMaximum,
    dailyMaximum: Math.min(profile.dailyLimit, windowCapacity),
    warmup: profile.warmupEnabled,
  };
}
