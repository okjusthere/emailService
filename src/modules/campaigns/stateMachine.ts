import { CampaignStatus } from "@prisma/client";
import { DomainError } from "../../shared/errors.js";

const transitions: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  DRAFT: ["READY"],
  READY: ["SNAPSHOTTING", "CANCELLED"],
  SNAPSHOTTING: ["QUEUED", "SCHEDULED", "FAILED"],
  SCHEDULED: ["QUEUED", "CANCELLED"],
  QUEUED: ["SENDING", "CANCELLED"],
  SENDING: ["PAUSED", "CANCELLED", "COMPLETED", "FAILED"],
  PAUSED: ["SENDING", "CANCELLED"],
  COMPLETED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  FAILED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function assertCampaignTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!transitions[from].includes(to)) {
    throw new DomainError(
      "CAMPAIGN_INVALID_STATE",
      `Campaign cannot transition from ${from} to ${to}.`,
      409,
      { from, to }
    );
  }
}

export function isCampaignEditable(status: CampaignStatus): boolean {
  return status === CampaignStatus.DRAFT || status === CampaignStatus.READY;
}
