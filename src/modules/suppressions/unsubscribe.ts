import { config } from "../../config/index.js";
import { prisma } from "../../db/prisma.js";
import { hashUnsubscribeToken, verifyUnsubscribeToken } from "../../email/compliance.js";
import { DomainError } from "../../shared/errors.js";
import { upsertSuppression } from "./domain.js";

export async function unsubscribeByToken(token: string, source: "VISIBLE_LINK" | "ONE_CLICK") {
  const recipientId = verifyUnsubscribeToken(token, config.sessionSecret);
  if (!recipientId)
    throw new DomainError("UNSUBSCRIBE_TOKEN_INVALID", "The unsubscribe link is invalid.", 400);
  return prisma.$transaction(async (tx) => {
    const recipient = await tx.campaignRecipient.findUnique({ where: { id: recipientId } });
    if (!recipient || recipient.unsubscribeTokenHash !== hashUnsubscribeToken(token))
      throw new DomainError("UNSUBSCRIBE_TOKEN_INVALID", "The unsubscribe link is invalid.", 400);
    await upsertSuppression(tx, {
      email: recipient.email,
      reason: "UNSUBSCRIBE",
      source: "USER",
      campaignId: recipient.campaignId,
      campaignRecipientId: recipient.id,
      details: { unsubscribeSource: source },
    });
    await tx.unsubscribeEvent.create({
      data: {
        campaignRecipientId: recipient.id,
        emailNormalized: recipient.emailNormalized,
        source,
      },
    });
    await tx.campaignRecipient.updateMany({
      where: {
        emailNormalized: recipient.emailNormalized,
        sendState: { in: ["PENDING", "RESERVED", "TEMPORARY_FAILED"] },
      },
      data: {
        sendState: "SUPPRESSED",
        suppressionReason: "UNSUBSCRIBE",
        claimToken: null,
        claimExpiresAt: null,
      },
    });
    return { emailMasked: recipient.email.replace(/^(.).+(@.*)$/, "$1***$2") };
  });
}
