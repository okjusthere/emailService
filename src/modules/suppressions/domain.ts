import { Prisma, type SuppressionReason } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { normalizeEmail } from "../../shared/normalize.js";
import { logger } from "../../shared/logger.js";

const severity: Record<SuppressionReason, number> = {
  COMPLAINT: 9,
  UNSUBSCRIBE: 8,
  HARD_BOUNCE: 7,
  PROVIDER_SUPPRESSED: 6,
  INVALID_ADDRESS: 5,
  MANUAL: 4,
  LEGACY_BOUNCE_REVIEW: 3,
  BOUNCE_REVIEW: 2,
  SOFT_BOUNCE: 1,
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
  const incomingIsAtLeastAsStrict = Prisma.sql`
    (CASE EXCLUDED.reason
      WHEN 'COMPLAINT'::"SuppressionReason" THEN 9
      WHEN 'UNSUBSCRIBE'::"SuppressionReason" THEN 8
      WHEN 'HARD_BOUNCE'::"SuppressionReason" THEN 7
      WHEN 'PROVIDER_SUPPRESSED'::"SuppressionReason" THEN 6
      WHEN 'INVALID_ADDRESS'::"SuppressionReason" THEN 5
      WHEN 'MANUAL'::"SuppressionReason" THEN 4
      WHEN 'LEGACY_BOUNCE_REVIEW'::"SuppressionReason" THEN 3
      WHEN 'BOUNCE_REVIEW'::"SuppressionReason" THEN 2
      ELSE 1
    END) >=
    (CASE suppressions.reason
      WHEN 'COMPLAINT'::"SuppressionReason" THEN 9
      WHEN 'UNSUBSCRIBE'::"SuppressionReason" THEN 8
      WHEN 'HARD_BOUNCE'::"SuppressionReason" THEN 7
      WHEN 'PROVIDER_SUPPRESSED'::"SuppressionReason" THEN 6
      WHEN 'INVALID_ADDRESS'::"SuppressionReason" THEN 5
      WHEN 'MANUAL'::"SuppressionReason" THEN 4
      WHEN 'LEGACY_BOUNCE_REVIEW'::"SuppressionReason" THEN 3
      WHEN 'BOUNCE_REVIEW'::"SuppressionReason" THEN 2
      ELSE 1
    END)
  `;
  const details = input.details === undefined ? null : JSON.stringify(input.details);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO suppressions (
      id, email, email_normalized, reason, source, is_active, details,
      campaign_id, campaign_recipient_id, suppressed_at, created_at, updated_at
    ) VALUES (
      ${randomUUID()}::uuid,
      ${input.email.trim()},
      ${emailNormalized},
      ${input.reason}::"SuppressionReason",
      ${input.source}::"SuppressionSource",
      true,
      ${details}::jsonb,
      ${input.campaignId ?? null}::uuid,
      ${input.campaignRecipientId ?? null}::uuid,
      now(),
      now(),
      now()
    )
    ON CONFLICT (email_normalized) DO UPDATE SET
      reason = CASE WHEN ${incomingIsAtLeastAsStrict} THEN EXCLUDED.reason ELSE suppressions.reason END,
      source = CASE WHEN ${incomingIsAtLeastAsStrict} THEN EXCLUDED.source ELSE suppressions.source END,
      details = CASE WHEN ${incomingIsAtLeastAsStrict} THEN EXCLUDED.details ELSE suppressions.details END,
      campaign_id = CASE WHEN ${incomingIsAtLeastAsStrict} THEN EXCLUDED.campaign_id ELSE suppressions.campaign_id END,
      campaign_recipient_id = CASE WHEN ${incomingIsAtLeastAsStrict} THEN EXCLUDED.campaign_recipient_id ELSE suppressions.campaign_recipient_id END,
      is_active = true,
      released_at = NULL,
      released_by_user_id = NULL,
      release_reason = NULL,
      suppressed_at = now(),
      updated_at = now()
  `);
  const suppression = await tx.suppression.findUniqueOrThrow({ where: { emailNormalized } });
  // The effective reason is a priority projection, not a replacement for cause
  // history. Record even weaker incoming causes so a later release can review all
  // complaints, unsubscribes, bounces and administrator decisions for this address.
  await tx.auditLog.create({
    data: {
      action: "suppression.cause_recorded",
      entityType: "suppression",
      entityId: suppression.id,
      after: {
        reason: input.reason,
        source: input.source,
        effectiveReason: suppression.reason,
        campaignId: input.campaignId ?? null,
        campaignRecipientId: input.campaignRecipientId ?? null,
        details: input.details ?? null,
      },
    },
  });
  logger.info(
    {
      event: "suppression_created",
      suppressionId: suppression.id,
      campaignId: input.campaignId,
      campaignRecipientId: input.campaignRecipientId,
      reason: suppression.reason,
      source: suppression.source,
    },
    "Global suppression activated"
  );
  return suppression;
}
