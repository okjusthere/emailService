import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { classifyBounce } from "../src/modules/webhooks/classification.js";

// Intentionally no apply mode. A candidate remains suppressed until an operator
// reviews its full history; this report never releases or resends any recipient.
const args = process.argv.slice(2);
if (args.some((arg, index) => arg !== "--limit" && args[index - 1] !== "--limit")) {
  throw new Error("Read-only usage: tsx scripts/audit-bounce-classification.ts [--limit 500]");
}
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 500;
if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
  throw new Error("--limit must be an integer between 1 and 10000");
}

function object(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const db = new PrismaClient();
try {
  const report = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const where = { isActive: true, reason: "HARD_BOUNCE" as const };
      const total = await tx.suppression.count({ where });
      const suppressions = await tx.suppression.findMany({
        where,
        orderBy: { id: "asc" },
        take: limit,
      });
      const results = [];
      for (const suppression of suppressions) {
        const events = await tx.emailEvent.findMany({
          where: {
            OR: [
              { campaignRecipient: { emailNormalized: suppression.emailNormalized } },
              { recipientEmail: { equals: suppression.emailNormalized, mode: "insensitive" } },
            ],
            eventType: { in: ["email.bounced", "email.complained", "email.suppressed"] },
          },
          select: {
            id: true,
            webhookId: true,
            eventType: true,
            payload: true,
            reconciliationStatus: true,
          },
        });
        const unsubscribeCount = await tx.unsubscribeEvent.count({
          where: { emailNormalized: suppression.emailNormalized },
        });
        const audit = await tx.auditLog.findMany({
          where: { entityId: suppression.id },
          select: { action: true, after: true },
        });
        const bounces = events.filter((event) => event.eventType === "email.bounced");
        const permanentCount = bounces.filter(
          (event) => classifyBounce(event.payload).type === "Permanent"
        ).length;
        const unknownCount = bounces.filter(
          (event) => classifyBounce(event.payload).type === "Undetermined"
        ).length;
        const transientCount = bounces.length - permanentCount - unknownCount;
        const suppressionWebhook = object(suppression.details).webhookId;
        const blockers = [
          ...(suppression.source !== "RESEND" ? ["non_provider_suppression"] : []),
          ...(permanentCount > 0 ? ["permanent_bounce_evidence"] : []),
          ...(unknownCount > 0 || bounces.length === 0
            ? ["missing_or_unknown_bounce_evidence"]
            : []),
          ...(events.some((event) => event.eventType === "email.complained")
            ? ["complaint_evidence"]
            : []),
          ...(events.some((event) => event.eventType === "email.suppressed")
            ? ["provider_suppression_evidence"]
            : []),
          ...(unsubscribeCount > 0 ? ["unsubscribe_evidence"] : []),
          ...(events.some((event) => event.reconciliationStatus !== "PROCESSED")
            ? ["unprocessed_event_evidence"]
            : []),
          ...(!bounces.some((event) => event.webhookId === suppressionWebhook)
            ? ["suppression_cause_not_linked"]
            : []),
          ...(audit.some((entry) => {
            const cause = object(entry.after);
            if (entry.action === "suppression.manual") return true;
            if (entry.action !== "suppression.cause_recorded") return false;
            if (
              cause.reason === "HARD_BOUNCE" &&
              object(cause.details ?? null).bounceType !== "Transient"
            )
              return true;
            return [
              "COMPLAINT",
              "UNSUBSCRIBE",
              "MANUAL",
              "PROVIDER_SUPPRESSED",
              "INVALID_ADDRESS",
              "LEGACY_BOUNCE_REVIEW",
              "BOUNCE_REVIEW",
            ].includes(String(cause.reason));
          })
            ? ["other_suppression_cause_history"]
            : []),
        ];
        results.push({
          suppressionId: suppression.id,
          classification: blockers.length === 0 ? "review_candidate" : "keep_suppressed",
          safeToRelease: false,
          proposedReasonAfterReview: blockers.length === 0 ? "SOFT_BOUNCE" : null,
          blockerReasons: blockers,
          bounceEvidence: {
            permanent: permanentCount,
            transient: transientCount,
            undetermined: unknownCount,
          },
          eventIds: events.map((event) => event.id),
        });
      }
      return {
        mode: "read_only",
        generatedAt: new Date().toISOString(),
        totalActiveHardBounces: total,
        examined: results.length,
        truncated: results.length < total,
        note: "Candidate means historical reclassification needs review, not permission to send. No suppression is released and no campaign is retried. Legacy cause history may be incomplete.",
        results,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 }
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.$disconnect();
}
