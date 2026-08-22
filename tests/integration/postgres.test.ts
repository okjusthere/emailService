import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/config/index.js";
import { prisma } from "../../src/db/prisma.js";
import { claimDueJob, reserveCampaignRecipients } from "../../src/db/rawQueries.js";
import { inTransaction } from "../../src/db/transactions.js";
import { FakeEmailProvider } from "../../src/email/providers/FakeEmailProvider.js";
import type {
  ProviderBatchResult,
  ProviderMessage,
} from "../../src/email/providers/EmailProvider.js";
import { setEmailProviderForTest } from "../../src/email/providers/index.js";
import type { ListingEmailSnapshot } from "../../src/email/render.js";
import {
  createCampaign,
  listCampaigns,
  markCampaignReady,
  previewCampaign,
  queueCampaignSnapshot,
  snapshotCampaign,
  testSendCampaign,
  transitionCampaign,
  updateCampaign,
} from "../../src/modules/campaigns/service.js";
import { dispatchCampaign, executeReservedBatch } from "../../src/modules/delivery/service.js";
import { localDate } from "../../src/modules/delivery/quota.js";
import { ingestWebhook, processWebhookEvent } from "../../src/modules/webhooks/service.js";
import { recomputeCampaignStats } from "../../src/modules/analytics/service.js";
import { resolveAzureUser } from "../../src/modules/auth/service.js";
import {
  confirmedImportMapping,
  processContactImport,
  queueContactImport,
  validateContactImport,
} from "../../src/modules/imports/service.js";
import { upsertSuppression } from "../../src/modules/suppressions/domain.js";
import { getPrivateObjectStorage } from "../../src/storage/PrivateObjectStorage.js";
import { completeClaimedJob, failClaimedJob } from "../../src/worker/jobRunner.js";

const frozenContent: ListingEmailSnapshot = {
  listing: {
    id: "frozen",
    title: "Frozen Listing",
    address: "10 Main Street",
    city: "Huntington",
    stateCode: "NY",
    postalCode: "11743",
    priceText: "$1,000,000",
    highlights: ["Test"],
    facts: [{ label: "Building", value: "1,000 SF" }],
    heroUrl: "https://assets.example.com/hero.jpg",
    heroAlt: "Building",
  },
  agent: { name: "Test Agent", email: "agent@example.com" },
  sender: {
    fromName: "Homix Listings",
    fromEmail: "listings@example.com",
    replyTo: "agent@example.com",
  },
  company: {
    name: "Homix Realty",
    postalAddress: "123 Main Street, Huntington, NY 11743",
    website: "https://homixny.com",
  },
  content: {
    subject: "A frozen listing",
    introHtml: "<p>Hello.</p>",
    ctaLabel: "View listing",
    ctaUrl: "https://homixny.com/listing",
  },
  templateVersion: "listing-branded@1",
};

let actorId: string;

describe("Azure identity binding", () => {
  it("claims only unbound provisioned emails and rejects a different object ID", async () => {
    const marker = randomUUID();
    const email = `entra-${marker}@example.com`;
    const user = await prisma.user.create({
      data: { email, emailNormalized: email, role: "ADMIN" },
    });
    const claimed = await resolveAzureUser({ objectId: marker, email, displayName: "First User" });
    expect(claimed).toMatchObject({ id: user.id, entraObjectId: marker, role: "ADMIN" });

    await expect(
      resolveAzureUser({ objectId: randomUUID(), email, displayName: "Different User" })
    ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH", status: 403 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      entraObjectId: marker,
      role: "ADMIN",
    });
  });
});

async function createFixture(recipientCount: number, status: "QUEUED" | "SENDING" = "QUEUED") {
  const key = randomUUID();
  const sender = await prisma.senderProfile.create({
    data: {
      name: `Integration ${key}`,
      fromName: "Homix Integration",
      fromEmail: `${key}@example.com`,
      fromEmailNormalized: `${key}@example.com`,
      domain: "example.com",
      fixedReplyToEmail: "agent@example.com",
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
      dailyLimit: 100,
      batchSize: 100,
      minBatchIntervalSeconds: 1,
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      sendWindowStart: "00:00",
      sendWindowEnd: "23:59",
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      name: `Integration ${key}`,
      status,
      senderProfileId: sender.id,
      templateKey: "LISTING_BRANDED",
      subject: frozenContent.content.subject,
      ctaLabel: frozenContent.content.ctaLabel,
      ctaUrl: frozenContent.content.ctaUrl,
      audienceFilter: {},
      contentSnapshot: frozenContent,
      createdByUserId: actorId,
      updatedByUserId: actorId,
      targetCount: recipientCount,
      eligibleCount: recipientCount,
    },
  });
  await prisma.campaignRecipient.createMany({
    data: Array.from({ length: recipientCount }, (_, index) => ({
      campaignId: campaign.id,
      email: `recipient-${key}-${index}@example.com`,
      emailNormalized: `recipient-${key}-${index}@example.com`,
      firstName: `Recipient ${index}`,
      unsubscribeTokenHash: `${key.replaceAll("-", "")}${index}`,
    })),
  });
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id },
    orderBy: { createdAt: "asc" },
  });
  return { sender, campaign, recipients };
}

async function reserveAll(fixture: Awaited<ReturnType<typeof createFixture>>, limit = 100) {
  const claimed = await reserveCampaignRecipients({
    campaignId: fixture.campaign.id,
    senderProfileId: fixture.sender.id,
    localDate: localDate(new Date(), fixture.sender.timezone),
    timezone: fixture.sender.timezone,
    effectiveLimit: limit,
    requested: 100,
  });
  if (!claimed) throw new Error("Expected recipients to be reserved");
  return claimed;
}

function testActor() {
  return {
    userId: actorId,
    role: "ADMIN" as const,
    requestId: randomUUID(),
    maskedIp: "127.0.0.x",
    userAgent: "vitest",
  };
}

async function createRenderableCampaign() {
  const key = randomUUID();
  const agent = await prisma.agent.create({
    data: {
      firstName: "Alex",
      lastName: "Broker",
      displayName: `Alex Broker ${key}`,
      email: `agent-${key}@example.com`,
      emailNormalized: `agent-${key}@example.com`,
      phone: "+1 631 555 0100",
      title: "Licensed Real Estate Broker",
      headshotUrl: "https://assets.example.com/headshot.jpg",
      signatureHtml: "<p>Alex Broker</p>",
    },
  });
  const listing = await prisma.listing.create({
    data: {
      internalName: `Campaign listing ${key}`,
      title: "Fully rendered integration listing",
      slug: `campaign-listing-${key}`,
      status: "ACTIVE",
      transactionType: "FOR_SALE",
      propertyType: "OFFICE",
      addressLine1: "10 Main Street",
      city: "Huntington",
      stateCode: "NY",
      postalCode: "11743",
      askingPrice: 1_250_000,
      buildingSqFt: 10_000,
      lotSqFt: 20_000,
      zoning: "C-1",
      capRate: 0.065,
      shortDescription: "A complete test listing.",
      highlights: ["Corner location", "Recently renovated"],
      listingUrl: "https://homixny.com/listings/integration",
      agentId: agent.id,
      createdByUserId: actorId,
      updatedByUserId: actorId,
      assets: {
        create: {
          kind: "HERO",
          blobName: `integration/${key}.jpg`,
          publicUrl: "https://assets.example.com/hero.jpg",
          mimeType: "image/jpeg",
          byteSize: 1024,
          altText: "Integration listing",
          isEmailSafe: true,
        },
      },
    },
  });
  const sender = await prisma.senderProfile.create({
    data: {
      name: `Campaign sender ${key}`,
      fromName: "Homix Listings",
      fromEmail: `sender-${key}@example.com`,
      fromEmailNormalized: `sender-${key}@example.com`,
      domain: "example.com",
      fixedReplyToEmail: "reply@example.com",
      verificationStatus: "VERIFIED",
      verifiedAt: new Date(),
      dailyLimit: 100,
      batchSize: 50,
      minBatchIntervalSeconds: 1,
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      sendWindowStart: "00:00",
      sendWindowEnd: "23:59",
    },
  });
  const contacts = await Promise.all(
    ["eligible", "unknown", "suppressed", "previous"].map((kind) =>
      prisma.contact.create({
        data: {
          email: `${kind}-${key}@example.com`,
          emailNormalized: `${kind}-${key}@example.com`,
          firstName: kind,
          displayName: `${kind} contact`,
          sourceType: "MANUAL",
          permissionBasis: kind === "unknown" ? "UNKNOWN" : "BUSINESS_CONTACT",
        },
      })
    )
  );
  await prisma.suppression.create({
    data: {
      email: contacts[2]!.email,
      emailNormalized: contacts[2]!.emailNormalized,
      reason: "MANUAL",
      source: "ADMIN",
    },
  });
  const priorCampaign = await prisma.campaign.create({
    data: {
      name: `Prior listing send ${key}`,
      status: "COMPLETED",
      listingId: listing.id,
      senderProfileId: sender.id,
      templateKey: "LISTING_BRANDED",
      subject: "Prior campaign",
      ctaLabel: "View listing",
      ctaUrl: listing.listingUrl,
      audienceFilter: {},
      createdByUserId: actorId,
      updatedByUserId: actorId,
    },
  });
  await prisma.campaignRecipient.create({
    data: {
      campaignId: priorCampaign.id,
      contactId: contacts[3]!.id,
      email: contacts[3]!.email,
      emailNormalized: contacts[3]!.emailNormalized,
      unsubscribeTokenHash: randomUUID().replaceAll("-", ""),
      sendState: "ACCEPTED",
    },
  });
  const campaign = await createCampaign(
    {
      name: `Lifecycle ${key}`,
      listingId: listing.id,
      senderProfileId: sender.id,
      replyToAgentId: agent.id,
      templateKey: "LISTING_BRANDED",
      subject: "Lifecycle campaign",
      preheader: "Integration preheader",
      introHtml: '<p>Hello</p><script>alert("unsafe")</script>',
      introText: "Hello",
      ctaLabel: "View listing",
      ctaUrl: listing.listingUrl,
      audienceFilter: {
        includeContactIds: contacts.map((contact) => contact.id),
        excludePreviouslySentListing: true,
        requireKnownPermissionBasis: true,
      },
      timezone: "America/New_York",
    },
    testActor()
  );
  return { agent, listing, sender, contacts, campaign };
}

describe("PostgreSQL delivery invariants", () => {
  beforeAll(async () => {
    const actor = await prisma.user.upsert({
      where: { emailNormalized: "integration@homixny.com" },
      create: {
        email: "integration@homixny.com",
        emailNormalized: "integration@homixny.com",
        displayName: "Integration Admin",
        role: "ADMIN",
      },
      update: { role: "ADMIN", isActive: true },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    setEmailProviderForTest(undefined);
    await prisma.$disconnect();
  });

  it("migrates from empty PostgreSQL and seeds reference data idempotently", async () => {
    const migrations = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    expect(Number(migrations[0]?.count)).toBeGreaterThan(0);
    expect(await prisma.propertyInterest.count()).toBeGreaterThanOrEqual(10);
    expect(await prisma.market.count()).toBeGreaterThanOrEqual(7);
    expect(await prisma.tag.count()).toBeGreaterThanOrEqual(5);
    expect(await prisma.senderProfile.count({ where: { isDefault: true } })).toBe(1);
  });

  it("marks a malformed import failed and retries processed rows idempotently", async () => {
    const marker = randomUUID();
    const email = `import-${marker}@example.com`;
    const blobName = `contact-imports/${marker}.csv`;
    await getPrivateObjectStorage().put(
      blobName,
      Buffer.from(`email,name\n${email},Imported Contact\n"unterminated`),
      "text/csv"
    );
    const contactImport = await prisma.contactImport.create({
      data: {
        fileName: "malformed.csv",
        blobName,
        sourceMetadata: { sourceType: "MANUAL", permissionBasis: "BUSINESS_CONTACT" },
        status: "PROCESSING",
        createdByUserId: actorId,
      },
    });

    await expect(processContactImport(contactImport.id)).rejects.toThrow();
    expect(
      await prisma.contactImport.findUniqueOrThrow({ where: { id: contactImport.id } })
    ).toMatchObject({ status: "FAILED", totalRows: 1, createdCount: 1, updatedCount: 0 });
    expect(await prisma.contact.count({ where: { emailNormalized: email } })).toBe(1);

    await expect(processContactImport(contactImport.id)).rejects.toThrow();
    expect(
      await prisma.contactImport.findUniqueOrThrow({ where: { id: contactImport.id } })
    ).toMatchObject({ status: "FAILED", totalRows: 1, createdCount: 1, updatedCount: 0 });
    expect(
      await prisma.contactImportRow.count({ where: { contactImportId: contactImport.id } })
    ).toBe(1);
    expect(await prisma.contact.count({ where: { emailNormalized: email } })).toBe(1);
  });

  it("queues an import once without resetting an active worker lease", async () => {
    const importId = (
      await prisma.contactImport.create({
        data: {
          fileName: "concurrent.csv",
          sourceMetadata: { sourceType: "MANUAL", permissionBasis: "BUSINESS_CONTACT" },
          mapping: {
            columns: { email: "email" },
            unknownReferences: { tags: [], markets: [], propertyInterests: [] },
            createUnknownReferences: false,
          },
          status: "READY",
          createdByUserId: actorId,
        },
      })
    ).id;

    const queued = await Promise.all([
      queueContactImport(importId, false),
      queueContactImport(importId, false),
    ]);
    expect(queued.map((result) => result.status)).toEqual(["PROCESSING", "PROCESSING"]);
    expect(queued.filter((result) => result.alreadyProcessing)).toHaveLength(1);
    expect(await prisma.job.count({ where: { uniqueKey: `IMPORT_CONTACTS/${importId}` } })).toBe(1);

    const leaseExpiry = new Date(Date.now() + 60_000);
    await prisma.job.update({
      where: { uniqueKey: `IMPORT_CONTACTS/${importId}` },
      data: {
        status: "RUNNING",
        attempts: 3,
        lockedBy: "active-import-worker",
        lockedAt: new Date(),
        lockExpiresAt: leaseExpiry,
      },
    });
    await expect(queueContactImport(importId, false)).resolves.toMatchObject({
      status: "PROCESSING",
      alreadyProcessing: true,
    });
    expect(
      await prisma.job.findUniqueOrThrow({ where: { uniqueKey: `IMPORT_CONTACTS/${importId}` } })
    ).toMatchObject({
      status: "RUNNING",
      attempts: 3,
      lockedBy: "active-import-worker",
      lockExpiresAt: leaseExpiry,
    });
  });

  it("requires explicit column mapping and unknown-reference confirmation", async () => {
    const marker = randomUUID();
    const email = `mapped-${marker}@example.com`;
    const existingEmail = `mapped-existing-${marker}@example.com`;
    const blobName = `contact-imports/${marker}.csv`;
    await prisma.contact.create({
      data: {
        email: existingEmail,
        emailNormalized: existingEmail,
        displayName: "Before import",
        sourceType: "MANUAL",
        permissionBasis: "UNKNOWN",
      },
    });
    await prisma.suppression.create({
      data: {
        email: existingEmail,
        emailNormalized: existingEmail,
        reason: "MANUAL",
        source: "ADMIN",
      },
    });
    await getPrivateObjectStorage().put(
      blobName,
      Buffer.from(
        [
          "Email Address,Full Name,Labels,Markets,Interests",
          `${email},Mapped Contact,New Custom Tag,North Fork,Medical Office`,
          `${email},Duplicate Contact,New Custom Tag,North Fork,Medical Office`,
          "not-an-email,Invalid Contact,New Custom Tag,North Fork,Medical Office",
          `${existingEmail},Updated Contact,New Custom Tag,North Fork,Medical Office`,
        ].join("\n")
      ),
      "text/csv"
    );
    const contactImport = await prisma.contactImport.create({
      data: {
        fileName: "mapped.csv",
        blobName,
        sourceMetadata: { sourceType: "CRM_IMPORT", permissionBasis: "BUSINESS_CONTACT" },
        createdByUserId: actorId,
      },
    });

    const validation = await validateContactImport(contactImport.id, {
      email: "email address",
      name: "full name",
      tags: "labels",
      markets: "markets",
      property_interests: "interests",
    });
    expect(validation).toMatchObject({
      totalRows: 4,
      valid: 2,
      invalid: 1,
      duplicates: 1,
      suppressed: 1,
    });
    expect(validation.unknownReferences.tags).toEqual(["new custom tag"]);
    expect(validation.unknownReferences.markets).toEqual(["north-fork"]);
    expect(validation.unknownReferences.propertyInterests).toEqual(["medical-office"]);
    const ready = await prisma.contactImport.findUniqueOrThrow({ where: { id: contactImport.id } });
    expect(() => confirmedImportMapping(ready.mapping, false)).toThrow(/Confirm creation/);
    const mapping = confirmedImportMapping(ready.mapping, true);
    await prisma.contactImport.update({
      where: { id: contactImport.id },
      data: { status: "PROCESSING", mapping },
    });

    await processContactImport(contactImport.id);

    expect(
      await prisma.contact.findUniqueOrThrow({ where: { emailNormalized: email } })
    ).toMatchObject({
      displayName: "Mapped Contact",
    });
    expect(
      await prisma.contactTag.count({
        where: { contact: { emailNormalized: email }, tag: { normalizedName: "new custom tag" } },
      })
    ).toBe(1);
    expect(
      await prisma.contactImport.findUniqueOrThrow({ where: { id: contactImport.id } })
    ).toMatchObject({
      status: "COMPLETED",
      totalRows: 4,
      createdCount: 1,
      updatedCount: 1,
      skippedCount: 1,
      invalidCount: 1,
      suppressedCount: 1,
    });
    expect(
      await prisma.contact.findUniqueOrThrow({ where: { emailNormalized: existingEmail } })
    ).toMatchObject({ displayName: "Updated Contact", permissionBasis: "BUSINESS_CONTACT" });
    expect(
      await prisma.contactMarket.count({
        where: { contact: { emailNormalized: existingEmail }, market: { slug: "north-fork" } },
      })
    ).toBe(1);
    expect(
      await prisma.contactPropertyInterest.count({
        where: {
          contact: { emailNormalized: existingEmail },
          propertyInterest: { slug: "medical-office" },
        },
      })
    ).toBe(1);
  });

  it("rejects missing import files and mappings to absent columns", async () => {
    const missing = await prisma.contactImport.create({
      data: {
        fileName: "missing.csv",
        sourceMetadata: { sourceType: "MANUAL", permissionBasis: "BUSINESS_CONTACT" },
        createdByUserId: actorId,
      },
    });
    await expect(validateContactImport(missing.id)).rejects.toThrow("Import file is missing");
    await expect(processContactImport(missing.id)).rejects.toThrow("Import file is missing");

    const blobName = `contact-imports/${randomUUID()}.csv`;
    await getPrivateObjectStorage().put(
      blobName,
      Buffer.from("email,name\nvalid@example.com,Valid"),
      "text/csv"
    );
    const invalidMapping = await prisma.contactImport.create({
      data: {
        fileName: "bad-mapping.csv",
        blobName,
        sourceMetadata: { sourceType: "MANUAL", permissionBasis: "BUSINESS_CONTACT" },
        createdByUserId: actorId,
      },
    });
    await expect(
      validateContactImport(invalidMapping.id, { email: "missing email column" })
    ).rejects.toThrow("Mapped CSV column not found");
  });

  it("runs the complete campaign draft, preview, test, ready, and snapshot lifecycle", async () => {
    const fixture = await createRenderableCampaign();
    const mutableConfig = config as {
      deliveryMode: "disabled" | "sandbox" | "live";
      testAllowlist: string[];
    };
    const originalMode = mutableConfig.deliveryMode;
    const originalAllowlist = mutableConfig.testAllowlist;
    const testEmail = "admin@homixny.com";
    try {
      const page = await listCampaigns({
        page: 1,
        limit: 1,
        search: fixture.campaign.name,
        status: "DRAFT",
        listingId: fixture.listing.id,
        senderProfileId: fixture.sender.id,
        createdByUserId: actorId,
        dateFrom: new Date(0).toISOString(),
        dateTo: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(page).toMatchObject({ total: 1, page: 1, limit: 1 });
      expect(page.items[0]?.id).toBe(fixture.campaign.id);
      expect(page.nextCursor).toBe(fixture.campaign.id);
      const unfilteredPage = await listCampaigns({ page: 1, limit: 100 });
      expect(unfilteredPage.items.length).toBeGreaterThan(1);
      expect(unfilteredPage.nextCursor).toBeNull();
      const cursorPage = await listCampaigns({
        page: 1,
        limit: 100,
        cursor: fixture.campaign.id,
      });
      expect(cursorPage.items.every((item) => item.id !== fixture.campaign.id)).toBe(true);

      const preview = await previewCampaign(fixture.campaign.id, {
        firstName: "Preview",
        fullName: "Preview Recipient",
        company: "Homix",
      });
      expect(preview.subject).toBe("Lifecycle campaign");
      expect(preview.html).toContain("Fully rendered integration listing");
      expect(preview.html).not.toContain("<script");

      mutableConfig.deliveryMode = "disabled";
      await expect(
        testSendCampaign(fixture.campaign.id, testEmail, fixture.campaign.version, testActor())
      ).rejects.toMatchObject({ code: "DELIVERY_DISABLED" });

      mutableConfig.deliveryMode = "sandbox";
      mutableConfig.testAllowlist = [testEmail];
      await expect(
        testSendCampaign(
          fixture.campaign.id,
          "not-allowlisted@example.com",
          fixture.campaign.version,
          testActor()
        )
      ).rejects.toMatchObject({ code: "TEST_RECIPIENT_NOT_ALLOWED" });
      await expect(
        testSendCampaign(fixture.campaign.id, testEmail, fixture.campaign.version + 1, testActor())
      ).rejects.toMatchObject({ code: "CAMPAIGN_VERSION_CONFLICT" });

      const rejectedProvider = new FakeEmailProvider();
      rejectedProvider.mode = "permanent";
      setEmailProviderForTest(rejectedProvider);
      await expect(
        testSendCampaign(fixture.campaign.id, testEmail, fixture.campaign.version, testActor())
      ).rejects.toMatchObject({ code: "TEST_SEND_FAILED" });

      const acceptedProvider = new FakeEmailProvider();
      setEmailProviderForTest(acceptedProvider);
      await expect(
        testSendCampaign(
          fixture.campaign.id,
          testEmail.toUpperCase(),
          fixture.campaign.version,
          testActor()
        )
      ).resolves.toMatchObject({
        accepted: true,
        providerEmailId: expect.stringMatching(/^fake_/),
      });
      expect(acceptedProvider.outbound[0]?.messages[0]).toMatchObject({
        to: testEmail,
        subject: "[TEST] Lifecycle campaign",
        headers: { "X-Homix-Test": "true" },
      });

      const ready = await markCampaignReady(fixture.campaign.id, testActor());
      expect(ready.status).toBe("READY");
      await expect(markCampaignReady(fixture.campaign.id, testActor())).rejects.toMatchObject({
        code: "CAMPAIGN_INVALID_STATE",
      });

      const scheduledAt = new Date(Date.now() + 60 * 60_000);
      const snapping = await queueCampaignSnapshot(
        fixture.campaign.id,
        testActor(),
        fixture.campaign.version,
        scheduledAt,
        "integration queue!"
      );
      expect(snapping.status).toBe("SNAPSHOTTING");
      await expect(
        queueCampaignSnapshot(
          fixture.campaign.id,
          testActor(),
          fixture.campaign.version,
          scheduledAt,
          "integration queue!"
        )
      ).resolves.toMatchObject({ status: "SNAPSHOTTING" });
      expect(
        await prisma.job.count({
          where: { uniqueKey: `SNAPSHOT_CAMPAIGN/${fixture.campaign.id}/integrationqueue` },
        })
      ).toBe(1);

      const scheduled = await snapshotCampaign(
        fixture.campaign.id,
        testActor(),
        fixture.campaign.version,
        scheduledAt,
        "integration queue!"
      );
      expect(scheduled).toMatchObject({
        status: "SCHEDULED",
        targetCount: 4,
        eligibleCount: 1,
        suppressedCount: 3,
      });
      expect(scheduled.audienceSnapshotSummary).toMatchObject({
        matched: 4,
        eligible: 1,
        suppressed: 3,
        unknownPermission: 1,
        previouslySent: 1,
      });
      expect(
        await prisma.campaignRecipient.count({
          where: { campaignId: fixture.campaign.id, sendState: "SUPPRESSED" },
        })
      ).toBe(3);
      await expect(
        snapshotCampaign(
          fixture.campaign.id,
          testActor(),
          fixture.campaign.version,
          scheduledAt,
          "integration queue!"
        )
      ).resolves.toMatchObject({ status: "SCHEDULED" });
      await expect(
        updateCampaign(
          fixture.campaign.id,
          { subject: "Locked edit" },
          fixture.campaign.version,
          testActor()
        )
      ).rejects.toMatchObject({ code: "CAMPAIGN_LOCKED" });
    } finally {
      mutableConfig.deliveryMode = originalMode;
      mutableConfig.testAllowlist = originalAllowlist;
      setEmailProviderForTest(undefined);
    }
  });

  it("pauses and resumes a sending campaign with one durable resume job", async () => {
    const fixture = await createFixture(1, "SENDING");
    const paused = await transitionCampaign(fixture.campaign.id, "pause", testActor());
    expect(paused.status).toBe("PAUSED");
    const resumed = await transitionCampaign(fixture.campaign.id, "resume", testActor());
    expect(resumed.status).toBe("SENDING");
    await prisma.campaign.update({
      where: { id: fixture.campaign.id },
      data: { status: "PAUSED" },
    });
    await transitionCampaign(fixture.campaign.id, "resume", testActor());
    expect(
      await prisma.job.count({
        where: { uniqueKey: `DISPATCH_CAMPAIGN/${fixture.campaign.id}/resume` },
      })
    ).toBe(1);
  });

  it("never revives a campaign when cancel races with pause or resume", async () => {
    for (const action of ["pause", "resume"] as const) {
      const initialStatus = action === "pause" ? "SENDING" : "PAUSED";
      const fixture = await createFixture(1, "SENDING");
      if (initialStatus === "PAUSED")
        await prisma.campaign.update({
          where: { id: fixture.campaign.id },
          data: { status: initialStatus },
        });

      await Promise.allSettled([
        transitionCampaign(fixture.campaign.id, action, testActor()),
        transitionCampaign(fixture.campaign.id, "cancel", testActor()),
      ]);
      expect(
        await prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } })
      ).toMatchObject({ status: "CANCELLED" });
    }
  });

  it("returns stable not-found errors across campaign commands", async () => {
    const id = randomUUID();
    await expect(previewCampaign(id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_FOUND" });
    await expect(markCampaignReady(id, testActor())).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
    await expect(queueCampaignSnapshot(id, testActor(), 1)).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
    await expect(transitionCampaign(id, "cancel", testActor())).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
    await expect(updateCampaign(id, { name: "Missing" }, 1, testActor())).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
    });
  });

  it("allows only one worker to claim a due durable job", async () => {
    const job = await prisma.job.create({
      data: {
        type: "CLEANUP_EXPIRED_DATA",
        uniqueKey: `claim/${randomUUID()}`,
        payload: {},
        runAt: new Date(0),
      },
    });
    const claims = await Promise.all([claimDueJob("worker-a", 120), claimDueJob("worker-b", 120)]);
    expect(claims.filter((item) => item?.id === job.id)).toHaveLength(1);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "RUNNING", lockExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await claimDueJob("worker-after-crash", 120))?.id).toBe(job.id);
  });

  it("prevents a stale worker from completing or failing a reclaimed job", async () => {
    const job = await prisma.job.create({
      data: {
        type: "CLEANUP_EXPIRED_DATA",
        uniqueKey: `lease-owner/${randomUUID()}`,
        payload: {},
        status: "RUNNING",
        attempts: 2,
        lockedAt: new Date(),
        lockedBy: "current-worker",
        lockExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(completeClaimedJob(job.id, "stale-worker")).resolves.toBe(false);
    await expect(failClaimedJob(job, "stale-worker", "stale failure")).resolves.toBe(false);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "RUNNING",
      lockedBy: "current-worker",
      lastError: null,
    });
    await expect(completeClaimedJob(job.id, "current-worker")).resolves.toBe(true);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "COMPLETED",
      lockedBy: null,
    });
  });

  it("keeps the strictest suppression under concurrent webhook-style writes", async () => {
    const email = `suppression-race-${randomUUID()}@example.com`;
    await Promise.all([
      inTransaction((tx) =>
        upsertSuppression(tx, { email, reason: "COMPLAINT", source: "RESEND" })
      ),
      inTransaction((tx) => upsertSuppression(tx, { email, reason: "MANUAL", source: "ADMIN" })),
    ]);
    expect(
      await prisma.suppression.findUniqueOrThrow({ where: { emailNormalized: email } })
    ).toMatchObject({
      reason: "COMPLAINT",
      source: "RESEND",
      isActive: true,
    });
  });

  it("keeps a durable wake-up without provider calls while delivery is disabled", async () => {
    const fixture = await createFixture(1);
    const provider = new FakeEmailProvider();
    setEmailProviderForTest(provider);

    await dispatchCampaign({ campaignId: fixture.campaign.id });

    expect(provider.outbound).toHaveLength(0);
    const hold = await prisma.job.findFirstOrThrow({
      where: {
        type: "DISPATCH_CAMPAIGN",
        uniqueKey: { startsWith: `DISPATCH_CAMPAIGN/${fixture.campaign.id}/disabled-` },
      },
    });
    expect(hold).toMatchObject({ status: "PENDING", payload: { campaignId: fixture.campaign.id } });
    expect(hold.runAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
  });

  it("treats missing, terminal, and unknown reserved batches as safe delivery no-ops", async () => {
    const provider = new FakeEmailProvider();
    setEmailProviderForTest(provider);
    await executeReservedBatch(randomUUID(), randomUUID());
    await dispatchCampaign({ campaignId: randomUUID() });

    const terminal = await createFixture(1);
    await prisma.campaign.update({
      where: { id: terminal.campaign.id },
      data: { status: "CANCELLED" },
    });
    await dispatchCampaign({ campaignId: terminal.campaign.id });
    await executeReservedBatch(terminal.campaign.id, randomUUID());
    expect(provider.outbound).toHaveLength(0);
  });

  it("enforces pause, recovery, window, sandbox, and quota gates at dispatch", async () => {
    const mutableConfig = config as {
      deliveryMode: "disabled" | "sandbox" | "live";
      testAllowlist: string[];
    };
    const originalMode = mutableConfig.deliveryMode;
    const originalAllowlist = mutableConfig.testAllowlist;
    mutableConfig.deliveryMode = "sandbox";
    mutableConfig.testAllowlist = ["admin@homixny.com"];
    const provider = new FakeEmailProvider();
    setEmailProviderForTest(provider);
    try {
      const paused = await createFixture(1);
      await prisma.systemSetting.upsert({
        where: { key: "GLOBAL_SEND_PAUSED" },
        create: { key: "GLOBAL_SEND_PAUSED", value: true },
        update: { value: true },
      });
      await prisma.systemSetting.upsert({
        where: { key: "RECOVERY_GUARD" },
        create: { key: "RECOVERY_GUARD", value: { required: false } },
        update: { value: { required: false } },
      });
      await dispatchCampaign({ campaignId: paused.campaign.id });
      expect(
        await prisma.job.count({
          where: { uniqueKey: { startsWith: `DISPATCH_CAMPAIGN/${paused.campaign.id}/paused-` } },
        })
      ).toBe(1);

      const recovery = await createFixture(1);
      await prisma.systemSetting.update({
        where: { key: "GLOBAL_SEND_PAUSED" },
        data: { value: false },
      });
      await prisma.systemSetting.update({
        where: { key: "RECOVERY_GUARD" },
        data: { value: { required: true } },
      });
      await dispatchCampaign({ campaignId: recovery.campaign.id });
      expect(
        await prisma.job.count({
          where: { uniqueKey: { startsWith: `DISPATCH_CAMPAIGN/${recovery.campaign.id}/paused-` } },
        })
      ).toBe(1);

      await prisma.systemSetting.update({
        where: { key: "RECOVERY_GUARD" },
        data: { value: { required: false } },
      });
      const outsideWindow = await createFixture(1);
      await prisma.senderProfile.update({
        where: { id: outsideWindow.sender.id },
        data: { allowedWeekdays: [(new Date().getUTCDay() + 1) % 7] },
      });
      await dispatchCampaign({ campaignId: outsideWindow.campaign.id });
      expect(
        await prisma.job.count({
          where: {
            uniqueKey: { startsWith: `DISPATCH_CAMPAIGN/${outsideWindow.campaign.id}/window-` },
          },
        })
      ).toBe(1);

      const denied = await createFixture(1);
      await dispatchCampaign({ campaignId: denied.campaign.id });
      expect(
        await prisma.campaignRecipient.findUniqueOrThrow({
          where: { id: denied.recipients[0]!.id },
        })
      ).toMatchObject({ sendState: "PERMANENT_FAILED", lastErrorCode: "sandbox_recipient_denied" });
      expect(
        await prisma.campaign.findUniqueOrThrow({ where: { id: denied.campaign.id } })
      ).toMatchObject({
        status: "COMPLETED",
        completedAt: expect.any(Date),
      });

      const quota = await createFixture(1);
      await prisma.campaignRecipient.update({
        where: { id: quota.recipients[0]!.id },
        data: { email: "admin@homixny.com", emailNormalized: "admin@homixny.com" },
      });
      await prisma.senderDailyUsage.create({
        data: {
          senderProfileId: quota.sender.id,
          localDate: localDate(new Date(), quota.sender.timezone),
          timezone: quota.sender.timezone,
          acceptedCount: quota.sender.dailyLimit,
        },
      });
      await dispatchCampaign({ campaignId: quota.campaign.id });
      expect(
        await prisma.job.count({
          where: { uniqueKey: { startsWith: `DISPATCH_CAMPAIGN/${quota.campaign.id}/quota-` } },
        })
      ).toBe(1);
      expect(provider.outbound).toHaveLength(0);
    } finally {
      mutableConfig.deliveryMode = originalMode;
      mutableConfig.testAllowlist = originalAllowlist;
      await prisma.systemSetting.update({
        where: { key: "GLOBAL_SEND_PAUSED" },
        data: { value: true },
      });
      await prisma.systemSetting.update({
        where: { key: "RECOVERY_GUARD" },
        data: { value: { required: true } },
      });
    }
  });

  it("serializes concurrent quota reservations without duplicate recipients", async () => {
    const fixture = await createFixture(20);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        reserveCampaignRecipients({
          campaignId: fixture.campaign.id,
          senderProfileId: fixture.sender.id,
          localDate: localDate(new Date(), fixture.sender.timezone),
          timezone: fixture.sender.timezone,
          effectiveLimit: 5,
          requested: 5,
        })
      )
    );
    expect(results.reduce((total, item) => total + (item?.reserved ?? 0), 0)).toBe(5);
    const sending = await prisma.campaignRecipient.findMany({
      where: { campaignId: fixture.campaign.id, sendState: "SENDING" },
    });
    expect(new Set(sending.map((item) => item.id)).size).toBe(5);
    const usage = await prisma.senderDailyUsage.findUniqueOrThrow({
      where: {
        senderProfileId_localDate: {
          senderProfileId: fixture.sender.id,
          localDate: localDate(new Date(), fixture.sender.timezone),
        },
      },
    });
    expect(usage.reservedCount + usage.acceptedCount).toBeLessThanOrEqual(5);
  });

  it("double-checks suppression after reservation and before provider submission", async () => {
    const fixture = await createFixture(1);
    const claimed = await reserveAll(fixture);
    await prisma.suppression.create({
      data: {
        email: fixture.recipients[0]!.email,
        emailNormalized: fixture.recipients[0]!.emailNormalized,
        reason: "UNSUBSCRIBE",
        source: "USER",
      },
    });
    const provider = new FakeEmailProvider();
    setEmailProviderForTest(provider);
    await executeReservedBatch(fixture.campaign.id, claimed.batchId);
    expect(provider.outbound).toHaveLength(0);
    expect(
      (
        await prisma.campaignRecipient.findUniqueOrThrow({
          where: { id: fixture.recipients[0]!.id },
        })
      ).sendState
    ).toBe("SUPPRESSED");
    const usage = await prisma.senderDailyUsage.findUniqueOrThrow({
      where: {
        senderProfileId_localDate: {
          senderProfileId: fixture.sender.id,
          localDate: localDate(new Date(), fixture.sender.timezone),
        },
      },
    });
    expect(usage).toMatchObject({ reservedCount: 0, acceptedCount: 0, releasedCount: 1 });
  });

  it("pauses delivery and suspends the sender at configured complaint thresholds", async () => {
    const fixture = await createFixture(100, "SENDING");
    await prisma.campaignRecipient.updateMany({
      where: { campaignId: fixture.campaign.id },
      data: { sendState: "ACCEPTED", acceptedAt: new Date() },
    });
    await prisma.campaignRecipient.update({
      where: { id: fixture.recipients[0]!.id },
      data: { deliveryState: "COMPLAINED", complainedAt: new Date() },
    });
    const stats = await recomputeCampaignStats(fixture.campaign.id);
    expect(stats.complaintRate).toBe(0.01);
    expect(
      (await prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } })).status
    ).toBe("PAUSED");
    expect(
      (await prisma.senderProfile.findUniqueOrThrow({ where: { id: fixture.sender.id } }))
        .verificationStatus
    ).toBe("SUSPENDED");
    expect(
      await prisma.systemSetting.findUniqueOrThrow({ where: { key: "DELIVERABILITY_ALERT" } })
    ).toMatchObject({ value: { actionRequired: true, campaignId: fixture.campaign.id } });
  });

  it("rolls back the snapshot status and recipients when the audience is empty", async () => {
    const fixture = await createFixture(0);
    const broker = await prisma.agent.create({
      data: {
        firstName: "Snapshot",
        lastName: "Broker",
        displayName: `Snapshot Broker ${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        emailNormalized: `${randomUUID()}@example.net`,
      },
    });
    const listing = await prisma.listing.create({
      data: {
        internalName: `Snapshot ${randomUUID()}`,
        title: "Snapshot rollback listing",
        slug: `snapshot-${randomUUID()}`,
        transactionType: "FOR_SALE",
        propertyType: "OFFICE",
        addressLine1: "1 Transaction Way",
        city: "Huntington",
        stateCode: "NY",
        postalCode: "11743",
        askingPrice: 1,
        listingUrl: "https://homixny.com/listing",
        agentId: broker.id,
        createdByUserId: actorId,
        updatedByUserId: actorId,
        assets: {
          create: {
            kind: "HERO",
            blobName: `integration/${randomUUID()}.jpg`,
            publicUrl: "https://assets.example.com/hero.jpg",
            mimeType: "image/jpeg",
            byteSize: 1,
            isEmailSafe: true,
          },
        },
      },
    });
    await prisma.campaign.update({
      where: { id: fixture.campaign.id },
      data: {
        status: "READY",
        listingId: listing.id,
        audienceFilter: { includeContactIds: [randomUUID()] },
      },
    });
    const actor = {
      userId: actorId,
      requestId: randomUUID(),
      maskedIp: "127.0.0.x",
      userAgent: "vitest",
    };
    await expect(
      snapshotCampaign(fixture.campaign.id, actor, fixture.campaign.version + 1)
    ).rejects.toMatchObject({ code: "CAMPAIGN_VERSION_CONFLICT" });
    await expect(
      snapshotCampaign(fixture.campaign.id, actor, fixture.campaign.version)
    ).rejects.toMatchObject({ code: "AUDIENCE_EMPTY" });
    expect(
      (await prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } })).status
    ).toBe("READY");
    expect(
      await prisma.campaignRecipient.count({ where: { campaignId: fixture.campaign.id } })
    ).toBe(0);
    expect(
      await prisma.job.count({
        where: { uniqueKey: `DISPATCH_CAMPAIGN/${fixture.campaign.id}/default` },
      })
    ).toBe(0);
  });

  it("allows only one concurrent campaign edit for the same optimistic version", async () => {
    const fixture = await createFixture(0);
    await prisma.campaign.update({
      where: { id: fixture.campaign.id },
      data: { status: "DRAFT" },
    });
    const actor = {
      userId: actorId,
      requestId: randomUUID(),
      maskedIp: "127.0.0.x",
      userAgent: "vitest",
    };
    const results = await Promise.allSettled([
      updateCampaign(fixture.campaign.id, { name: "First concurrent edit" }, 1, actor),
      updateCampaign(fixture.campaign.id, { name: "Second concurrent edit" }, 1, actor),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "CAMPAIGN_VERSION_CONFLICT", status: 409 },
    });
    expect(
      (await prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } })).version
    ).toBe(2);
  });

  it("commits accepted recipients, attempts, and quota atomically", async () => {
    const fixture = await createFixture(2);
    const claimed = await reserveAll(fixture);
    const provider = new FakeEmailProvider();
    setEmailProviderForTest(provider);
    await executeReservedBatch(fixture.campaign.id, claimed.batchId);
    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId: fixture.campaign.id, sendState: "ACCEPTED" },
      })
    ).toBe(2);
    expect(
      await prisma.sendAttempt.count({
        where: { sendBatchId: claimed.batchId, outcome: "ACCEPTED" },
      })
    ).toBe(1);
    const batch = await prisma.sendBatch.findUniqueOrThrow({ where: { id: claimed.batchId } });
    expect(provider.outbound[0]?.idempotencyKey).toBe(batch.idempotencyKey);
    const usage = await prisma.senderDailyUsage.findUniqueOrThrow({
      where: {
        senderProfileId_localDate: {
          senderProfileId: fixture.sender.id,
          localDate: localDate(new Date(), fixture.sender.timezone),
        },
      },
    });
    expect(usage).toMatchObject({ reservedCount: 0, acceptedCount: 2 });
  });

  it("persists partial provider acceptance and releases only rejected quota", async () => {
    const fixture = await createFixture(2);
    const claimed = await reserveAll(fixture);
    const provider = new FakeEmailProvider();
    provider.mode = "partial";
    setEmailProviderForTest(provider);

    await executeReservedBatch(fixture.campaign.id, claimed.batchId);

    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId: fixture.campaign.id, sendState: "ACCEPTED" },
      })
    ).toBe(1);
    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId: fixture.campaign.id, sendState: "PERMANENT_FAILED" },
      })
    ).toBe(1);
    expect(
      await prisma.sendBatch.findUniqueOrThrow({ where: { id: claimed.batchId } })
    ).toMatchObject({ status: "PARTIAL", acceptedCount: 1, failedCount: 1 });
    expect(
      await prisma.sendAttempt.findFirstOrThrow({ where: { sendBatchId: claimed.batchId } })
    ).toMatchObject({ outcome: "PARTIAL" });
    const usage = await prisma.senderDailyUsage.findUniqueOrThrow({
      where: {
        senderProfileId_localDate: {
          senderProfileId: fixture.sender.id,
          localDate: localDate(new Date(), fixture.sender.timezone),
        },
      },
    });
    expect(usage).toMatchObject({ reservedCount: 0, acceptedCount: 1, releasedCount: 1 });
  });

  it("treats a missing provider item as a permanent per-recipient failure", async () => {
    class TruncatedProvider extends FakeEmailProvider {
      override async sendBatch(
        messages: ProviderMessage[],
        options: { idempotencyKey: string }
      ): Promise<ProviderBatchResult> {
        const result = await super.sendBatch(messages, options);
        return { ...result, items: result.items.slice(0, 1) };
      }
    }

    const fixture = await createFixture(2);
    const claimed = await reserveAll(fixture);
    setEmailProviderForTest(new TruncatedProvider());

    await executeReservedBatch(fixture.campaign.id, claimed.batchId);

    const failed = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId: fixture.campaign.id, sendState: "PERMANENT_FAILED" },
    });
    expect(failed).toMatchObject({
      lastErrorCode: "missing_provider_result",
      lastErrorMessage: "Provider returned no result",
    });
    expect(
      await prisma.sendBatch.findUniqueOrThrow({ where: { id: claimed.batchId } })
    ).toMatchObject({ status: "PARTIAL", acceptedCount: 1, failedCount: 1 });
  });

  it("retries a temporary failure with the identical batch idempotency key", async () => {
    const fixture = await createFixture(1);
    const claimed = await reserveAll(fixture);
    const provider = new FakeEmailProvider();
    provider.mode = "temporary";
    setEmailProviderForTest(provider);
    await executeReservedBatch(fixture.campaign.id, claimed.batchId);
    expect(
      (await prisma.sendBatch.findUniqueOrThrow({ where: { id: claimed.batchId } })).status
    ).toBe("TEMPORARY_FAILED");
    provider.mode = "accepted";
    await executeReservedBatch(fixture.campaign.id, claimed.batchId);
    expect(provider.outbound.map((item) => item.idempotencyKey)).toEqual([
      provider.outbound[0]!.idempotencyKey,
      provider.outbound[0]!.idempotencyKey,
    ]);
    expect(
      (
        await prisma.campaignRecipient.findUniqueOrThrow({
          where: { id: fixture.recipients[0]!.id },
        })
      ).sendState
    ).toBe("ACCEPTED");
  });

  it("holds an uncertain provider outcome for manual review and never blindly retries", async () => {
    const fixture = await createFixture(1);
    const claimed = await reserveAll(fixture);
    const provider = new FakeEmailProvider();
    provider.mode = "uncertain";
    setEmailProviderForTest(provider);
    await executeReservedBatch(fixture.campaign.id, claimed.batchId);
    expect(
      (await prisma.sendBatch.findUniqueOrThrow({ where: { id: claimed.batchId } })).status
    ).toBe("MANUAL_REVIEW");
    expect(
      (
        await prisma.campaignRecipient.findUniqueOrThrow({
          where: { id: fixture.recipients[0]!.id },
        })
      ).sendState
    ).toBe("MANUAL_REVIEW");
    await executeReservedBatch(fixture.campaign.id, claimed.batchId);
    expect(provider.outbound).toHaveLength(1);
  });

  it("reduces duplicate and out-of-order webhook events without state regression", async () => {
    const fixture = await createFixture(1);
    const recipient = await prisma.campaignRecipient.update({
      where: { id: fixture.recipients[0]!.id },
      data: { sendState: "ACCEPTED", resendEmailId: `fake-${randomUUID()}` },
    });
    const opened = await prisma.emailEvent.create({
      data: {
        webhookId: `opened-${randomUUID()}`,
        eventType: "email.opened",
        providerEmailId: recipient.resendEmailId,
        eventCreatedAt: new Date("2026-08-21T15:00:00Z"),
        campaignRecipientId: recipient.id,
        payload: {},
      },
    });
    const delivered = await prisma.emailEvent.create({
      data: {
        webhookId: `delivered-${randomUUID()}`,
        eventType: "email.delivered",
        providerEmailId: recipient.resendEmailId,
        eventCreatedAt: new Date("2026-08-21T14:00:00Z"),
        campaignRecipientId: recipient.id,
        payload: {},
      },
    });
    await processWebhookEvent(opened.id);
    await processWebhookEvent(delivered.id);
    await processWebhookEvent(opened.id);
    const reduced = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: recipient.id },
    });
    expect(reduced.deliveryState).toBe("DELIVERED");
    expect(reduced.openedAt?.toISOString()).toBe("2026-08-21T15:00:00.000Z");
    expect(reduced.lastProviderEventAt?.toISOString()).toBe("2026-08-21T15:00:00.000Z");

    const complaint = await prisma.emailEvent.create({
      data: {
        webhookId: `complaint-${randomUUID()}`,
        eventType: "email.complained",
        providerEmailId: recipient.resendEmailId,
        eventCreatedAt: new Date("2026-08-21T13:00:00Z"),
        campaignRecipientId: recipient.id,
        payload: {},
      },
    });
    const deliveredAfterComplaint = await prisma.emailEvent.create({
      data: {
        webhookId: `delivered-after-complaint-${randomUUID()}`,
        eventType: "email.delivered",
        providerEmailId: recipient.resendEmailId,
        eventCreatedAt: new Date("2026-08-21T16:00:00Z"),
        campaignRecipientId: recipient.id,
        payload: {},
      },
    });
    await Promise.all([
      processWebhookEvent(complaint.id),
      processWebhookEvent(deliveredAfterComplaint.id),
    ]);
    const repeatedComplaint = await prisma.emailEvent.create({
      data: {
        webhookId: `complaint-repeat-${randomUUID()}`,
        eventType: "email.complained",
        providerEmailId: recipient.resendEmailId,
        eventCreatedAt: new Date("2026-08-21T17:00:00Z"),
        campaignRecipientId: recipient.id,
        payload: {},
      },
    });
    await processWebhookEvent(repeatedComplaint.id);
    expect(
      (await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } }))
        .deliveryState
    ).toBe("COMPLAINED");
    expect(
      (
        await prisma.suppression.findUniqueOrThrow({
          where: { emailNormalized: recipient.emailNormalized },
        })
      ).reason
    ).toBe("COMPLAINT");
  });

  it("creates durable suppressions for hard bounces and provider suppressions", async () => {
    for (const eventType of ["email.bounced", "email.suppressed"] as const) {
      const fixture = await createFixture(1);
      const recipient = await prisma.campaignRecipient.update({
        where: { id: fixture.recipients[0]!.id },
        data: { sendState: "ACCEPTED", resendEmailId: `fake-${randomUUID()}` },
      });
      const event = await prisma.emailEvent.create({
        data: {
          webhookId: `${eventType}-${randomUUID()}`,
          eventType,
          providerEmailId: recipient.resendEmailId,
          eventCreatedAt: new Date(),
          campaignRecipientId: recipient.id,
          payload: {},
        },
      });

      await processWebhookEvent(event.id);

      const repeated = await prisma.emailEvent.create({
        data: {
          webhookId: `${eventType}-repeat-${randomUUID()}`,
          eventType,
          providerEmailId: recipient.resendEmailId,
          eventCreatedAt: new Date(Date.now() + 60_000),
          campaignRecipientId: recipient.id,
          payload: {},
        },
      });
      await processWebhookEvent(repeated.id);

      const expected =
        eventType === "email.bounced"
          ? { deliveryState: "BOUNCED", reason: "HARD_BOUNCE" }
          : { deliveryState: "PROVIDER_SUPPRESSED", reason: "PROVIDER_SUPPRESSED" };
      expect(
        await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } })
      ).toMatchObject({ deliveryState: expected.deliveryState });
      expect(
        await prisma.suppression.findUniqueOrThrow({
          where: { emailNormalized: recipient.emailNormalized },
        })
      ).toMatchObject({ reason: expected.reason, source: "RESEND", isActive: true });
    }
  });

  it("retains and reduces sent, delayed, clicked, failed, unknown, and orphan events", async () => {
    const fixture = await createFixture(1);
    const recipient = await prisma.campaignRecipient.update({
      where: { id: fixture.recipients[0]!.id },
      data: { sendState: "ACCEPTED", resendEmailId: `fake-${randomUUID()}` },
    });
    for (const eventType of [
      "email.sent",
      "email.delivery_delayed",
      "email.clicked",
      "email.failed",
      "future.unknown",
    ]) {
      const event = await prisma.emailEvent.create({
        data: {
          webhookId: `${eventType}-${randomUUID()}`,
          eventType,
          providerEmailId: recipient.resendEmailId,
          eventCreatedAt: new Date(),
          campaignRecipientId: recipient.id,
          payload: {},
        },
      });
      await processWebhookEvent(event.id);
      expect(await prisma.emailEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
        processedAt: expect.any(Date),
        processingError: null,
      });
    }
    for (const eventType of ["email.opened", "email.clicked"] as const) {
      const repeated = await prisma.emailEvent.create({
        data: {
          webhookId: `${eventType}-repeat-${randomUUID()}`,
          eventType,
          providerEmailId: recipient.resendEmailId,
          eventCreatedAt: new Date(Date.now() + 60_000),
          campaignRecipientId: recipient.id,
          payload: {},
        },
      });
      await processWebhookEvent(repeated.id);
    }
    expect(
      await prisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } })
    ).toMatchObject({
      sendState: "PERMANENT_FAILED",
      clickedAt: expect.any(Date),
      lastErrorCode: "provider_failed",
    });

    const orphan = await prisma.emailEvent.create({
      data: {
        webhookId: `orphan-${randomUUID()}`,
        eventType: "email.delivered",
        providerEmailId: `missing-${randomUUID()}`,
        eventCreatedAt: new Date(),
        payload: {},
      },
    });
    await processWebhookEvent(orphan.id);
    expect(await prisma.emailEvent.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({
      processedAt: expect.any(Date),
      processingError: "orphan: no campaign recipient matched",
    });
  });

  it("ingests a signed webhook once and deduplicates replay", async () => {
    const fixture = await createFixture(1);
    const recipient = await prisma.campaignRecipient.update({
      where: { id: fixture.recipients[0]!.id },
      data: { sendState: "ACCEPTED", resendEmailId: `fake-${randomUUID()}` },
    });
    const provider = new FakeEmailProvider();
    const webhookId = `ingest-${randomUUID()}`;
    const rawBody = JSON.stringify({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      email_id: recipient.resendEmailId,
      recipient: recipient.email,
    });
    const input = {
      rawBody,
      headers: { "svix-id": webhookId, "svix-signature": "fake-valid" },
    };

    await expect(
      ingestWebhook(provider, {
        rawBody,
        headers: { "svix-signature": "fake-valid" },
      })
    ).rejects.toThrow("Missing svix-id");

    const noProviderId = `ingest-no-provider-${randomUUID()}`;
    const orphanIngest = await ingestWebhook(provider, {
      rawBody: JSON.stringify({
        type: "email.delivered",
        created_at: new Date().toISOString(),
        recipient: `missing-${randomUUID()}@example.com`,
      }),
      headers: { "svix-id": noProviderId, "svix-signature": "fake-valid" },
    });
    await processWebhookEvent(orphanIngest.id);
    expect(
      await prisma.emailEvent.findUniqueOrThrow({ where: { webhookId: noProviderId } })
    ).toMatchObject({ processingError: "orphan: no campaign recipient matched" });

    await expect(ingestWebhook(provider, input)).resolves.toMatchObject({ duplicate: false });
    await expect(ingestWebhook(provider, input)).resolves.toMatchObject({ duplicate: true });
    expect(await prisma.emailEvent.count({ where: { webhookId } })).toBe(1);
    expect(
      await prisma.job.count({ where: { uniqueKey: { startsWith: "PROCESS_WEBHOOK_EVENT/" } } })
    ).toBeGreaterThan(0);
  });

  it("cancels unsent recipients without calling the provider", async () => {
    const fixture = await createFixture(3, "SENDING");
    const provider = new FakeEmailProvider();
    setEmailProviderForTest(provider);
    await transitionCampaign(fixture.campaign.id, "cancel", {
      userId: actorId,
      requestId: randomUUID(),
      maskedIp: "127.0.0.x",
      userAgent: "vitest",
    });
    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId: fixture.campaign.id, sendState: "CANCELLED" },
      })
    ).toBe(3);
    expect(provider.outbound).toHaveLength(0);
  });

  it("releases reserved quota when a temporary-failure retry is cancelled", async () => {
    const fixture = await createFixture(2, "SENDING");
    const claimed = await reserveAll(fixture);
    const provider = new FakeEmailProvider();
    provider.mode = "temporary";
    setEmailProviderForTest(provider);
    await executeReservedBatch(fixture.campaign.id, claimed.batchId);

    await transitionCampaign(fixture.campaign.id, "cancel", {
      userId: actorId,
      requestId: randomUUID(),
      maskedIp: "127.0.0.x",
      userAgent: "vitest",
    });

    const usage = await prisma.senderDailyUsage.findUniqueOrThrow({
      where: {
        senderProfileId_localDate: {
          senderProfileId: fixture.sender.id,
          localDate: localDate(new Date(), fixture.sender.timezone),
        },
      },
    });
    expect(usage).toMatchObject({ reservedCount: 0, releasedCount: 2 });
    expect(
      await prisma.campaignRecipient.count({
        where: { campaignId: fixture.campaign.id, sendState: "CANCELLED" },
      })
    ).toBe(2);
    expect(
      await prisma.sendBatch.findUniqueOrThrow({ where: { id: claimed.batchId } })
    ).toMatchObject({
      status: "PERMANENT_FAILED",
      lastErrorCode: "campaign_cancelled",
      failedCount: 2,
    });
  });
});
