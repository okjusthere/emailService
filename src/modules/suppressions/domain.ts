import type { SuppressionReason } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { normalizeEmail } from "../../shared/normalize.js";
import { logger } from "../../shared/logger.js";

const severity: Record<SuppressionReason, number> = {
  COMPLAINT: 7,
  UNSUBSCRIBE: 6,
  HARD_BOUNCE: 5,
  PROVIDER_SUPPRESSED: 4,
  LEGACY_BOUNCE_REVIEW: 3,
  INVALID_ADDRESS: 2,
  MANUAL: 1,
};

export function stricterSuppression(
  current: SuppressionReason,
  incoming: SuppressionReason
): SuppressionReason {
  return severity[incoming] > severity[current] ? incoming : current;
}

export async function upsertSuppression(
  tx: Prisma.TransactionClient,
  input: {
    email: string;
    reason: SuppressionReason;
    source: "USER" | "RESEND" | "ADMIN" | "IMPORT" | "SYSTEM";
    campaignId?: string;
    campaignRecipientId?: string;
    details?: Prisma.InputJsonValue;
  }
) {
  const emailNormalized = normalizeEmail(input.email);
  const existing = await tx.suppression.findUnique({ where: { emailNormalized } });
  const reason = existing ? stricterSuppression(existing.reason, input.reason) : input.reason;
  const suppression = await tx.suppression.upsert({
    where: { emailNormalized },
    create: {
      email: input.email.trim(),
      emailNormalized,
      reason,
      source: input.source,
      isActive: true,
      campaignId: input.campaignId,
      campaignRecipientId: input.campaignRecipientId,
      details: input.details,
    },
    update: {
      reason,
      source: input.source,
      isActive: true,
      releasedAt: null,
      releasedByUserId: null,
      releaseReason: null,
      suppressedAt: new Date(),
      details: input.details,
    },
  });
  logger.info(
    {
      event: "suppression_created",
      suppressionId: suppression.id,
      campaignId: input.campaignId,
      campaignRecipientId: input.campaignRecipientId,
      reason,
      source: input.source,
    },
    "Global suppression activated"
  );
  return suppression;
}
