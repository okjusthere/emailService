import { createHash, randomUUID } from "node:crypto";
import { type Prisma, type SuppressionReason } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { upsertSuppression } from "../../src/modules/suppressions/domain.js";
import { processWebhookEvent } from "../../src/modules/webhooks/service.js";
import * as analytics from "../../src/modules/analytics/service.js";

const createdCampaignIds: string[] = [];
const createdSenderIds: string[] = [];
const createdUserIds: string[] = [];
const suppressionEmails: string[] = [];

async function fixture() {
  const id = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `actor-${id}@example.com`,
      emailNormalized: `actor-${id}@example.com`,
      role: "ADMIN",
    },
  });
  createdUserIds.push(user.id);
  const sender = await prisma.senderProfile.create({
    data: {
      name: `Webhook test ${id}`,
      fromName: "Test",
      fromEmail: `sender-${id}@example.com`,
      fromEmailNormalized: `sender-${id}@example.com`,
      domain: "example.com",
      fixedReplyToEmail: "reply@example.com",
    },
  });
  createdSenderIds.push(sender.id);
  const campaign = await prisma.campaign.create({
    data: {
      name: `Webhook test ${id}`,
      status: "SENDING",
      senderProfileId: sender.id,
      templateKey: "LISTING_BRANDED",
      subject: "Test",
      audienceFilter: {},
      contentSnapshot: {
        content: { ctaUrl: "https://homixny.com/listings/123" },
        company: { website: "https://homixny.com" },
      },
      createdByUserId: user.id,
      updatedByUserId: user.id,
    },
  });
  createdCampaignIds.push(campaign.id);
  const token = `token-${id}`;
  const recipient = await prisma.campaignRecipient.create({
    data: {
      campaignId: campaign.id,
      email: `recipient-${id}@example.com`,
      emailNormalized: `recipient-${id}@example.com`,
      unsubscribeTokenHash: createHash("sha256").update(token).digest("hex"),
      sendState: "ACCEPTED",
      acceptedAt: new Date("2026-09-22T13:00:00Z"),
      resendEmailId: `resend-${id}`,
    },
  });
  suppressionEmails.push(recipient.emailNormalized);
  return { campaign, recipient, token };
}

async function event(
  recipientId: string,
  eventType: string,
  data: Prisma.InputJsonObject = {},
  at = "2026-09-22T14:00:00Z"
) {
  const entry = await prisma.emailEvent.create({
    data: {
      webhookId: randomUUID(),
      eventType,
      campaignRecipientId: recipientId,
      eventCreatedAt: new Date(at),
      payload: { data },
    },
  });
  await processWebhookEvent(entry.id);
  return prisma.emailEvent.findUniqueOrThrow({ where: { id: entry.id } });
}

afterAll(async () => {
  const suppressions = await prisma.suppression.findMany({
    where: { emailNormalized: { in: suppressionEmails } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: suppressions.map((entry) => entry.id) } },
  });
  await prisma.suppression.deleteMany({ where: { emailNormalized: { in: suppressionEmails } } });
  await prisma.emailEvent.deleteMany({
    where: { campaignRecipient: { campaignId: { in: createdCampaignIds } } },
  });
  await prisma.job.deleteMany({
    where: {
      OR: createdCampaignIds.map((campaignId) => ({
        payload: { path: ["campaignId"], equals: campaignId },
      })),
    },
  });
  await prisma.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } });
  await prisma.senderProfile.deleteMany({ where: { id: { in: createdSenderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("webhook engagement and bounce reductions", () => {
  it("keeps a durable recompute job if immediate bounce statistics fail after event commit", async () => {
    const f = await fixture();
    const entry = await prisma.emailEvent.create({
      data: {
        webhookId: randomUUID(),
        eventType: "email.bounced",
        campaignRecipientId: f.recipient.id,
        eventCreatedAt: new Date(),
        payload: { data: { bounce: { type: "Transient" } } },
      },
    });
    const recompute = vi
      .spyOn(analytics, "recomputeCampaignStats")
      .mockRejectedValueOnce(new Error("temporary stats failure"));
    try {
      await expect(processWebhookEvent(entry.id)).rejects.toThrow("temporary stats failure");
      expect(
        (await prisma.emailEvent.findUniqueOrThrow({ where: { id: entry.id } }))
          .reconciliationStatus
      ).toBe("PROCESSED");
      await processWebhookEvent(entry.id);
      expect(recompute).toHaveBeenCalledTimes(1);
      const fallback = await prisma.job.findFirstOrThrow({
        where: {
          type: "RECOMPUTE_CAMPAIGN_STATS",
          payload: { path: ["campaignId"], equals: f.campaign.id },
        },
      });
      expect(fallback.status).toBe("PENDING");
    } finally {
      recompute.mockRestore();
    }
  });

  it("counts only the earliest eligible listing click and preserves all event classifications", async () => {
    const f = await fixture();
    const unsubscribe = await event(f.recipient.id, "email.clicked", {
      click: { link: `http://localhost:3000/unsubscribe?token=${f.token}` },
    });
    const bot = await event(f.recipient.id, "email.clicked", {
      click: { link: "https://homixny.com/listings/123", userAgent: "Googlebot/2.1" },
    });
    const company = await event(f.recipient.id, "email.clicked", {
      click: { link: "https://homixny.com" },
    });
    expect(unsubscribe.linkPurpose).toBe("unsubscribe");
    expect(bot.automationClassification).toBe("automated");
    expect(company.linkPurpose).toBe("company");
    expect(
      (await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: f.recipient.id } }))
        .listingClickedAt
    ).toBeNull();
    const later = await event(
      f.recipient.id,
      "email.clicked",
      { click: { link: "https://homixny.com/listings/123", userAgent: "Mozilla/5.0" } },
      "2026-09-22T15:00:00Z"
    );
    await event(
      f.recipient.id,
      "email.clicked",
      { click: { link: "https://homixny.com/listings/123" } },
      "2026-09-22T14:30:00Z"
    );
    await processWebhookEvent(later.id);
    const recipient = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: f.recipient.id },
    });
    expect(recipient.listingClickedAt?.toISOString()).toBe("2026-09-22T14:30:00.000Z");
    expect(recipient.clickedAt?.toISOString()).toBe("2026-09-22T14:00:00.000Z");
    expect(recipient.lastProviderEventAt?.toISOString()).toBe("2026-09-22T15:00:00.000Z");
    expect(later.automationClassification).toBe("unknown");
  });

  it.each([
    ["Permanent", "HARD_BOUNCE"],
    ["Transient", "SOFT_BOUNCE"],
    ["Undetermined", "BOUNCE_REVIEW"],
  ] as const)(
    "keeps %s bounce classification and its active suppression cause",
    async (type, reason) => {
      const f = await fixture();
      const bounce = await event(f.recipient.id, "email.bounced", {
        bounce: { type, subType: "General", message: `DNS failure: ${f.recipient.email}` },
      });
      await processWebhookEvent(bounce.id);
      const recipient = await prisma.campaignRecipient.findUniqueOrThrow({
        where: { id: f.recipient.id },
      });
      expect(recipient).toMatchObject({
        bounceType: type,
        bounceSubType: "General",
        deliveryState: "BOUNCED",
        sendState: "ACCEPTED",
      });
      expect(recipient.bounceReason).not.toContain(f.recipient.email);
      const suppression = await prisma.suppression.findUniqueOrThrow({
        where: { emailNormalized: f.recipient.emailNormalized },
      });
      expect(suppression).toMatchObject({ reason, isActive: true, releasedAt: null });
      const audit = await prisma.auditLog.findMany({
        where: { entityId: suppression.id, action: "suppression.cause_recorded" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toMatchObject({ reason, effectiveReason: reason });
    }
  );

  it("preserves complaint state and permanent evidence through late soft bounce and delivered events", async () => {
    const f = await fixture();
    await event(f.recipient.id, "email.complained", {}, "2026-09-22T16:00:00Z");
    await event(
      f.recipient.id,
      "email.bounced",
      { bounce: { type: "Permanent" } },
      "2026-09-22T15:00:00Z"
    );
    await event(
      f.recipient.id,
      "email.bounced",
      { bounce: { type: "Transient" } },
      "2026-09-22T17:00:00Z"
    );
    await event(f.recipient.id, "email.delivered", {}, "2026-09-22T14:00:00Z");
    const recipient = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: f.recipient.id },
    });
    expect(recipient).toMatchObject({
      deliveryState: "COMPLAINED",
      bounceType: "Permanent",
      sendState: "ACCEPTED",
    });
    expect(recipient.bouncedAt?.toISOString()).toBe("2026-09-22T15:00:00.000Z");
    expect(recipient.deliveredAt?.toISOString()).toBe("2026-09-22T14:00:00.000Z");
    expect(recipient.lastProviderEventAt?.toISOString()).toBe("2026-09-22T17:00:00.000Z");
    expect(
      (
        await prisma.suppression.findUniqueOrThrow({
          where: { emailNormalized: f.recipient.emailNormalized },
        })
      ).reason
    ).toBe("COMPLAINT");
  });

  it("keeps concurrent suppression updates monotonic and records every cause", async () => {
    const email = `suppression-priority-${randomUUID()}@example.com`;
    suppressionEmails.push(email);
    const reasons: SuppressionReason[] = [
      "SOFT_BOUNCE",
      "COMPLAINT",
      "HARD_BOUNCE",
      "BOUNCE_REVIEW",
      "MANUAL",
      "UNSUBSCRIBE",
    ];
    await Promise.all(
      reasons.map((reason) =>
        prisma.$transaction((tx) => upsertSuppression(tx, { email, reason, source: "SYSTEM" }))
      )
    );
    const suppression = await prisma.suppression.findUniqueOrThrow({
      where: { emailNormalized: email },
    });
    expect(suppression.reason).toBe("COMPLAINT");
    expect(
      await prisma.auditLog.count({
        where: { entityId: suppression.id, action: "suppression.cause_recorded" },
      })
    ).toBe(reasons.length);
  });
});
