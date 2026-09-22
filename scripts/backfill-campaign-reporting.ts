import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { campaignStatsUpdate, readCampaignStats } from "../src/modules/analytics/snapshot.js";

// Only rebuilds derived campaign reports. No send, guard, suppression, provider,
// recipient or historical tracking mutation is imported or invoked here.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply"))
  throw new Error("Usage: tsx scripts/backfill-campaign-reporting.ts [--apply] (default: dry-run)");
const apply = args.includes("--apply");
const startedAt = new Date();
const totals = { examined: 0, updated: 0, skippedConcurrent: 0 };
let cursor: string | undefined;

try {
  for (;;) {
    const campaigns = await prisma.campaign.findMany({
      where: { createdAt: { lte: startedAt }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (campaigns.length === 0) break;
    for (const { id } of campaigns) {
      const outcome = await prisma.$transaction(async (tx) => {
        if (!apply) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const campaign = await tx.campaign.findUnique({
          where: { id },
          select: { statsComputedAt: true, updatedAt: true },
        });
        if (!campaign) return "skippedConcurrent";
        const snapshot = await readCampaignStats(id, tx);
        if (!apply) return "examined";
        const result = await tx.campaign.updateMany({
          // Avoid replacing a newer event-driven report or a concurrent campaign edit.
          where: { id, statsComputedAt: campaign.statsComputedAt, updatedAt: campaign.updatedAt },
          data: {
            ...campaignStatsUpdate(snapshot),
            // A reporting rollout must not move old campaigns to the top of the activity list.
            updatedAt: campaign.updatedAt,
          },
        });
        return result.count ? "updated" : "skippedConcurrent";
      });
      totals.examined += 1;
      if (outcome !== "examined") totals[outcome] += 1;
    }
    cursor = campaigns.at(-1)!.id;
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...totals, cursor }));
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      ...totals,
      complete: true,
      trackingHistoryChanged: false,
      guardsInvoked: false,
      ...(totals.skippedConcurrent
        ? { action: "Rerun to refresh campaigns skipped due concurrent changes." }
        : {}),
    })
  );
} finally {
  await prisma.$disconnect();
}
