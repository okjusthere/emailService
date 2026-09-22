import type { CampaignStatus, SenderProfile } from "@prisma/client";
import { isInsideSendWindow, nextSendWindow } from "../delivery/quota.js";

type SenderPacing = Pick<
  SenderProfile,
  | "isActive"
  | "verificationStatus"
  | "nextBatchAt"
  | "timezone"
  | "sendWindowStart"
  | "sendWindowEnd"
  | "allowedWeekdays"
>;

export interface SendingReporting {
  state:
    | "draft"
    | "ready"
    | "preparing"
    | "scheduled"
    | "sending"
    | "waiting_window"
    | "waiting_cadence"
    | "paused"
    | "blocked"
    | "completed"
    | "cancelled"
    | "failed"
    | "archived";
  nextSendAt: string | null;
  estimateKind: "earliest_possible" | null;
}

/** Queue contention and retries may delay this lower bound; it is not a completion promise. */
export function buildSendingReporting(
  campaign: { status: CampaignStatus; scheduledAt: Date | null; senderProfile: SenderPacing },
  now = new Date()
): SendingReporting {
  const inactiveStates = {
    DRAFT: "draft",
    READY: "ready",
    SNAPSHOTTING: "preparing",
    PAUSED: "paused",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    FAILED: "failed",
    ARCHIVED: "archived",
  } as const;
  if (campaign.status in inactiveStates)
    return {
      state: inactiveStates[campaign.status as keyof typeof inactiveStates],
      nextSendAt: null,
      estimateKind: null,
    };
  const sender = campaign.senderProfile;
  if (!sender.isActive || sender.verificationStatus !== "VERIFIED")
    return { state: "blocked", nextSendAt: null, estimateKind: null };
  const inside = (date: Date) =>
    isInsideSendWindow(
      date,
      sender.timezone,
      sender.sendWindowStart,
      sender.sendWindowEnd,
      sender.allowedWeekdays
    );
  const earliest = new Date(
    Math.max(
      now.getTime(),
      campaign.scheduledAt?.getTime() ?? 0,
      sender.nextBatchAt?.getTime() ?? 0
    )
  );
  const next = inside(earliest)
    ? earliest
    : nextSendWindow(
        earliest,
        sender.timezone,
        sender.sendWindowStart,
        sender.sendWindowEnd,
        sender.allowedWeekdays
      );
  return {
    state:
      campaign.status === "SCHEDULED" && campaign.scheduledAt && campaign.scheduledAt > now
        ? "scheduled"
        : !inside(now)
          ? "waiting_window"
          : earliest > now
            ? "waiting_cadence"
            : "sending",
    nextSendAt: next.toISOString(),
    estimateKind: "earliest_possible",
  };
}
