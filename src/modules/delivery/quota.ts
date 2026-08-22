export interface WarmupDay {
  day: number;
  limit: number;
}

export function effectiveDailyLimit(input: {
  dailyLimit: number;
  warmupEnabled: boolean;
  warmupStartDate: Date | null;
  warmupSchedule: WarmupDay[];
  now: Date;
  timezone: string;
}): number {
  if (!input.warmupEnabled || !input.warmupStartDate || input.warmupSchedule.length === 0)
    return input.dailyLimit;
  const dateKey = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: input.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  const start = new Date(`${dateKey(input.warmupStartDate)}T12:00:00Z`);
  const current = new Date(`${dateKey(input.now)}T12:00:00Z`);
  const day = Math.max(1, Math.floor((current.getTime() - start.getTime()) / 86_400_000) + 1);
  const sorted = [...input.warmupSchedule].sort((a, b) => a.day - b.day);
  let scheduledLimit = sorted[0]?.limit ?? input.dailyLimit;
  for (const entry of sorted) if (day >= entry.day) scheduledLimit = entry.limit;
  return Math.max(0, Math.min(input.dailyLimit, scheduledLimit));
}

export function remainingQuota(limit: number, accepted: number, reserved: number): number {
  return Math.max(0, limit - accepted - reserved);
}

export function localDate(now: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

export function isInsideSendWindow(
  now: Date,
  timezone: string,
  start: string,
  end: string,
  weekdays: number[]
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  const time = `${value("hour")}:${value("minute")}`;
  return weekdays.includes(weekday) && time >= start && time < end;
}

export function nextSendWindow(
  now: Date,
  timezone: string,
  start: string,
  end: string,
  weekdays: number[]
): Date {
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  for (let minute = 0; minute < 8 * 24 * 60; minute += 1) {
    if (isInsideSendWindow(candidate, timezone, start, end, weekdays)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
