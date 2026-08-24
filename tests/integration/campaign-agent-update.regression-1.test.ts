import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { updateCampaign } from "../../src/modules/campaigns/service.js";

describe("listing campaign agent identity updates", () => {
  let userId: string;

  beforeAll(async () => {
    const marker = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `campaign-agent-${marker}@example.com`,
        emailNormalized: `campaign-agent-${marker}@example.com`,
        role: "ADMIN",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps Reply-To synchronized while retaining legacy no-listing edits", async () => {
    const marker = randomUUID();
    const actor = {
      userId,
      role: "ADMIN" as const,
      requestId: randomUUID(),
      maskedIp: "127.0.0.x",
      userAgent: "vitest",
    };
    const [firstAgent, secondAgent] = await Promise.all(
      ["first", "second"].map((label) =>
        prisma.agent.create({
          data: {
            firstName: label,
            lastName: "Agent",
            displayName: `${label} Agent`,
            email: `${label}-${marker}@example.com`,
            emailNormalized: `${label}-${marker}@example.com`,
          },
        })
      )
    );
    const sender = await prisma.senderProfile.create({
      data: {
        name: `Agent regression ${marker}`,
        fromName: "Homix Listings",
        fromEmail: `sender-${marker}@example.com`,
        fromEmailNormalized: `sender-${marker}@example.com`,
        domain: "example.com",
      },
    });
    const listingData = (label: string, agentId: string) => ({
      internalName: `${label} ${marker}`,
      title: `${label} listing`,
      slug: `${label}-${marker}`,
      transactionType: "FOR_SALE" as const,
      propertyType: "OFFICE" as const,
      addressLine1: "10 Main Street",
      city: "Flushing",
      stateCode: "NY",
      postalCode: "11354",
      agentId,
      createdByUserId: userId,
      updatedByUserId: userId,
    });
    const [firstListing, secondListing] = await Promise.all([
      prisma.listing.create({ data: listingData("first", firstAgent!.id) }),
      prisma.listing.create({ data: listingData("second", secondAgent!.id) }),
    ]);
    const campaign = await prisma.campaign.create({
      data: {
        name: "Agent identity regression",
        listingId: firstListing.id,
        senderProfileId: sender.id,
        replyToAgentId: secondAgent!.id,
        templateKey: "LISTING_BRANDED",
        subject: "Agent identity regression",
        audienceFilter: {},
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });

    const repaired = await updateCampaign(campaign.id, { name: "Repaired" }, 1, actor);
    expect(repaired.replyToAgentId).toBe(firstAgent!.id);

    const protectedIdentity = await updateCampaign(
      campaign.id,
      { replyToAgentId: secondAgent!.id },
      repaired.version,
      actor
    );
    expect(protectedIdentity.replyToAgentId).toBe(firstAgent!.id);

    const moved = await updateCampaign(
      campaign.id,
      { listingId: secondListing.id },
      protectedIdentity.version,
      actor
    );
    expect(moved).toMatchObject({
      listingId: secondListing.id,
      replyToAgentId: secondAgent!.id,
    });

    await expect(
      updateCampaign(campaign.id, { listingId: randomUUID() }, moved.version, actor)
    ).rejects.toMatchObject({ code: "LISTING_NOT_FOUND", status: 404 });

    const legacy = await prisma.campaign.create({
      data: {
        name: "Legacy frozen campaign",
        senderProfileId: sender.id,
        templateKey: "LISTING_BRANDED",
        subject: "Legacy",
        audienceFilter: {},
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });
    await expect(
      updateCampaign(legacy.id, { name: "Legacy edited" }, 1, actor)
    ).resolves.toMatchObject({ name: "Legacy edited", replyToAgentId: null });
  });
});
