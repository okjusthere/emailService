import { CampaignStatus, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../../config/index.js";
import { inTransaction } from "../../db/transactions.js";
import { prisma } from "../../db/prisma.js";
import {
  createUnsubscribeToken,
  hashUnsubscribeToken,
  sanitizeIntro,
} from "../../email/compliance.js";
import { getEmailProvider } from "../../email/providers/index.js";
import { renderListingEmail, type ListingEmailSnapshot } from "../../email/render.js";
import { DomainError } from "../../shared/errors.js";
import { normalizeEmail } from "../../shared/normalize.js";
import { logger, maskEmail } from "../../shared/logger.js";
import { audienceFilterSchema, paginationSchema } from "../../shared/schemas.js";
import { resolveAudienceContacts } from "../audiences/service.js";
import type { ActorContext } from "../audit/service.js";
import { writeAudit } from "../audit/service.js";
import { localDate } from "../delivery/quota.js";
import { assertCampaignTransition, isCampaignEditable } from "./stateMachine.js";
import { campaignInputSchema } from "./schemas.js";
import { resolveListingAgentIdentity } from "./listingAgentIdentity.js";

function priceText(listing: {
  askingPrice: Prisma.Decimal | null;
  askingRentText: string | null;
  priceUponRequest: boolean;
  currency: string;
}): string {
  if (listing.askingPrice)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: listing.currency,
      maximumFractionDigits: 0,
    }).format(Number(listing.askingPrice));
  return (
    listing.askingRentText ||
    (listing.priceUponRequest ? "Price upon request" : "Contact broker for pricing")
  );
}

function snapshotFromCampaign(
  campaign: Awaited<ReturnType<typeof campaignForRendering>>
): ListingEmailSnapshot {
  if (!campaign?.listing)
    throw new DomainError("CAMPAIGN_LISTING_REQUIRED", "Campaign requires a listing.", 409);
  const hero = campaign.listing.assets.find(
    (asset) => asset.kind === "HERO" && asset.isEmailSafe && !asset.deletedAt
  );
  if (!hero)
    throw new DomainError(
      "LISTING_HERO_REQUIRED",
      "Listing requires an email-safe hero image.",
      409
    );
  const listingAgent = resolveListingAgentIdentity({
    listingAgent: campaign.listing.agent,
    legacyCampaignAgent: campaign.replyToAgent,
    legacyFixedReplyToEmail: campaign.senderProfile.fixedReplyToEmail,
  });
  const replyTo = listingAgent.email;
  const facts: Array<{ label: string; value: string }> = [];
  if (campaign.listing.buildingSqFt)
    facts.push({
      label: "Building",
      value: `${campaign.listing.buildingSqFt.toLocaleString()} SF`,
    });
  if (campaign.listing.lotSqFt)
    facts.push({ label: "Lot", value: `${Number(campaign.listing.lotSqFt).toLocaleString()} SF` });
  if (campaign.listing.zoning) facts.push({ label: "Zoning", value: campaign.listing.zoning });
  if (campaign.listing.capRate)
    facts.push({
      label: "Cap rate",
      value: `${(Number(campaign.listing.capRate) * 100).toFixed(2)}%`,
    });
  return {
    listing: {
      id: campaign.listing.id,
      title: campaign.listing.title,
      address: campaign.listing.addressLine1,
      city: campaign.listing.city,
      stateCode: campaign.listing.stateCode,
      postalCode: campaign.listing.postalCode,
      priceText: priceText(campaign.listing),
      description:
        campaign.listing.longDescription ?? campaign.listing.shortDescription ?? undefined,
      highlights: campaign.listing.highlights,
      facts: facts.slice(0, 6),
      heroUrl: hero.publicUrl,
      heroAlt: hero.altText ?? campaign.listing.title,
    },
    agent: {
      name: listingAgent.name,
      email: listingAgent.email,
      phone: listingAgent.phone,
      title: listingAgent.title,
      headshotUrl: listingAgent.headshotUrl,
      signatureHtml: listingAgent.signatureHtml,
    },
    sender: {
      fromName: campaign.senderProfile.fromName,
      fromEmail: campaign.senderProfile.fromEmail,
      replyTo,
    },
    company: {
      name: config.companyName,
      postalAddress: config.companyPostalAddress,
      website: config.companyWebsite,
    },
    content: {
      subject: campaign.subject,
      preheader: campaign.preheader ?? undefined,
      introHtml: sanitizeIntro(campaign.introHtml ?? ""),
      introText: campaign.introText ?? undefined,
      ctaLabel: campaign.ctaLabel,
      ctaUrl: campaign.ctaUrl ?? campaign.listing.listingUrl ?? config.companyListingsUrl,
    },
    templateVersion:
      campaign.templateKey === "LISTING_BRANDED" ? "listing-branded@2" : "broker-personal@2",
  };
}

async function campaignForRendering(id: string, tx: { campaign: typeof prisma.campaign } = prisma) {
  return tx.campaign.findUnique({
    where: { id },
    include: {
      senderProfile: true,
      replyToAgent: true,
      listing: { include: { agent: true, assets: { orderBy: { sortOrder: "asc" } } } },
    },
  });
}

function assertLiveReady(
  campaign: NonNullable<Awaited<ReturnType<typeof campaignForRendering>>>,
  snapshot: ListingEmailSnapshot
): void {
  if (campaign.listing?.status !== "ACTIVE")
    throw new DomainError("LISTING_NOT_ACTIVE", "Only active listings may be sent live.", 409);
  if (!campaign.senderProfile.isActive || campaign.senderProfile.verificationStatus !== "VERIFIED")
    throw new DomainError(
      "SENDER_NOT_VERIFIED",
      "The sender profile is not active and verified.",
      409
    );
  if (!snapshot.content.ctaUrl)
    throw new DomainError("CTA_URL_REQUIRED", "A listing or campaign CTA URL is required.", 409);
  if (campaign.lastTestedVersion !== campaign.version || !campaign.lastSuccessfulTestAt)
    throw new DomainError(
      "CURRENT_TEST_SEND_REQUIRED",
      "A successful test send is required for the current campaign version.",
      409
    );
  if (/REQUIRED|PLACEHOLDER/i.test(config.companyPostalAddress))
    throw new DomainError(
      "COMPANY_ADDRESS_REQUIRED",
      "Configure the company postal address before sending.",
      409
    );
}

export async function listCampaigns(query: unknown) {
  const page = paginationSchema
    .extend({
      status: z.enum(CampaignStatus).optional(),
      listingId: z.uuid().optional(),
      senderProfileId: z.uuid().optional(),
      createdByUserId: z.uuid().optional(),
      dateFrom: z.iso.datetime().optional(),
      dateTo: z.iso.datetime().optional(),
    })
    .parse(query);
  const where: Prisma.CampaignWhereInput = {
    ...(page.search ? { name: { contains: page.search, mode: "insensitive" } } : {}),
    ...(page.status ? { status: page.status } : {}),
    ...(page.listingId ? { listingId: page.listingId } : {}),
    ...(page.senderProfileId ? { senderProfileId: page.senderProfileId } : {}),
    ...(page.createdByUserId ? { createdByUserId: page.createdByUserId } : {}),
    ...(page.dateFrom || page.dateTo
      ? {
          createdAt: {
            ...(page.dateFrom ? { gte: new Date(page.dateFrom) } : {}),
            ...(page.dateTo ? { lte: new Date(page.dateTo) } : {}),
          },
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.campaign.findMany({
      where,
      cursor: page.cursor ? { id: page.cursor } : undefined,
      skip: page.cursor ? 1 : (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        listing: { select: { title: true } },
        senderProfile: { select: { name: true } },
        createdBy: { select: { displayName: true, email: true } },
      },
    }),
    prisma.campaign.count({ where }),
  ]);
  return {
    items,
    total,
    page: page.page,
    limit: page.limit,
    nextCursor: items.length === page.limit ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function createCampaign(body: unknown, actor: ActorContext) {
  const input = campaignInputSchema.parse(body);
  return inTransaction(async (tx) => {
    const listing = await tx.listing.findUnique({
      where: { id: input.listingId },
      select: { agentId: true },
    });
    if (!listing) throw new DomainError("LISTING_NOT_FOUND", "Listing not found.", 404);
    const campaign = await tx.campaign.create({
      data: {
        ...input,
        replyToAgentId: listing.agentId,
        introHtml: sanitizeIntro(input.introHtml ?? ""),
        audienceFilter: input.audienceFilter,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: "campaign.create",
      entityType: "campaign",
      entityId: campaign.id,
      after: { status: campaign.status, version: campaign.version },
    });
    return campaign;
  });
}

const QUICK_START_REUSE_HOURS = 24;

function quickStartName(address: string, now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `${address} · ${date}`.slice(0, 200);
}

export async function quickStartCampaign(listingId: string, actor: ActorContext) {
  return inTransaction(async (tx) => {
    const lockKey = `quick-start:${actor.userId}:${listingId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      include: { agent: true },
    });
    if (!listing) throw new DomainError("LISTING_NOT_FOUND", "Listing not found.", 404);

    const recent = await tx.campaign.findFirst({
      where: {
        listingId,
        createdByUserId: actor.userId,
        status: "DRAFT",
        updatedAt: { gte: new Date(Date.now() - QUICK_START_REUSE_HOURS * 3_600_000) },
      },
      orderBy: { updatedAt: "desc" },
      include: { listing: true, senderProfile: true, replyToAgent: true, savedAudience: true },
    });
    if (recent) {
      await writeAudit(tx, actor, {
        action: "campaign.quick_start_reused",
        entityType: "campaign",
        entityId: recent.id,
        after: { listingId },
      });
      return {
        campaign: recent,
        created: false,
        defaults: { senderResolved: true, replyToResolved: true, templateResolved: true },
      };
    }

    const sender = await tx.senderProfile.findFirst({
      where: { isActive: true, verificationStatus: "VERIFIED" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (!sender)
      throw new DomainError(
        "VERIFIED_SENDER_REQUIRED",
        "No verified sender is configured. Ask an admin to configure the From address.",
        409
      );
    const subject = `New listing: ${listing.title}`.slice(0, 150);
    const campaign = await tx.campaign.create({
      data: {
        name: quickStartName(listing.addressLine1),
        listingId,
        senderProfileId: sender.id,
        replyToAgentId: listing.agentId,
        templateKey: "LISTING_BRANDED",
        subject,
        preheader: `Take a look at ${listing.addressLine1}, ${listing.city}`.slice(0, 200),
        introHtml: sanitizeIntro(
          "<p>I wanted to share this new listing with you. Please reply if you would like more information or to arrange a showing.</p>"
        ),
        introText:
          "I wanted to share this new listing with you. Please reply if you would like more information or to arrange a showing.",
        ctaLabel: "View Listing",
        ctaUrl: listing.listingUrl ?? config.companyListingsUrl,
        audienceFilter: { includeContactIds: [], requireKnownPermissionBasis: true },
        timezone: "America/New_York",
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
      include: { listing: true, senderProfile: true, replyToAgent: true, savedAudience: true },
    });
    await writeAudit(tx, actor, {
      action: "campaign.quick_start_created",
      entityType: "campaign",
      entityId: campaign.id,
      after: { listingId, senderProfileId: sender.id },
    });
    return {
      campaign,
      created: true,
      defaults: { senderResolved: true, replyToResolved: true, templateResolved: true },
    };
  });
}

export async function updateCampaign(
  id: string,
  body: unknown,
  version: number,
  actor: ActorContext
) {
  const input = campaignInputSchema.partial().parse(body);
  return inTransaction(async (tx) => {
    const before = await tx.campaign.findUnique({
      where: { id },
      include: { listing: { select: { agentId: true } } },
    });
    if (!before) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    if (!isCampaignEditable(before.status))
      throw new DomainError(
        "CAMPAIGN_LOCKED",
        "Snapshotted campaigns are immutable; duplicate it to make changes.",
        409
      );
    if (before.version !== version)
      throw new DomainError(
        "CAMPAIGN_VERSION_CONFLICT",
        "Campaign was changed by another user.",
        409,
        { currentVersion: before.version }
      );
    const listingId = input.listingId ?? before.listingId;
    const targetListing =
      input.listingId && input.listingId !== before.listingId
        ? await tx.listing.findUnique({
            where: { id: input.listingId },
            select: { agentId: true },
          })
        : before.listing;
    if (listingId && !targetListing)
      throw new DomainError("LISTING_NOT_FOUND", "Listing not found.", 404);
    const shouldSynchronizeReplyTo =
      targetListing !== null &&
      (input.listingId !== undefined ||
        input.replyToAgentId !== undefined ||
        before.replyToAgentId !== targetListing.agentId);
    const result = await tx.campaign.updateMany({
      where: { id, version },
      data: {
        ...input,
        ...(shouldSynchronizeReplyTo ? { replyToAgentId: targetListing?.agentId } : {}),
        introHtml: input.introHtml === undefined ? undefined : sanitizeIntro(input.introHtml ?? ""),
        updatedByUserId: actor.userId,
        version: { increment: 1 },
        lastSuccessfulTestAt: null,
        lastTestedVersion: null,
      },
    });
    if (result.count !== 1)
      throw new DomainError(
        "CAMPAIGN_VERSION_CONFLICT",
        "Campaign was changed by another user.",
        409
      );
    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id } });
    await writeAudit(tx, actor, {
      action: "campaign.update",
      entityType: "campaign",
      entityId: id,
      before: { version: before.version },
      after: { version: campaign.version },
    });
    return campaign;
  });
}

export async function markCampaignReady(id: string, actor: ActorContext) {
  return inTransaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM campaigns WHERE id = ${id}::uuid FOR UPDATE
    `;
    const campaign = await tx.campaign.findUnique({ where: { id } });
    if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    assertCampaignTransition(campaign.status, CampaignStatus.READY);
    const updated = await tx.campaign.update({ where: { id }, data: { status: "READY" } });
    await writeAudit(tx, actor, { action: "campaign.ready", entityType: "campaign", entityId: id });
    return updated;
  });
}

export async function previewCampaign(
  id: string,
  recipient: { firstName?: string; fullName?: string; company?: string } = {}
) {
  const campaign = await campaignForRendering(id);
  if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
  const snapshot = snapshotFromCampaign(campaign);
  return renderListingEmail({
    snapshot,
    recipient: { ...recipient, unsubscribeUrl: `${config.baseUrl}/unsubscribe?token=preview` },
    templateKey: campaign.templateKey,
  });
}

export async function testSendCampaign(
  id: string,
  emailInput: string,
  version: number,
  clientRequestId: string,
  actor: ActorContext
) {
  if (config.deliveryMode === "disabled")
    throw new DomainError(
      "DELIVERY_DISABLED",
      "External test sending is disabled; preview remains available.",
      409
    );
  const actorUser = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { emailNormalized: true, displayName: true },
  });
  if (!actorUser)
    throw new DomainError("TEST_RECIPIENT_UNAVAILABLE", "Your test email is unavailable.", 403);
  const email = normalizeEmail(emailInput);
  if (email !== actorUser.emailNormalized)
    throw new DomainError(
      "TEST_RECIPIENT_MUST_BE_SELF",
      "Test emails can only be sent to the signed-in user.",
      403
    );
  if (!config.testAllowlist.includes(email))
    throw new DomainError(
      "TEST_RECIPIENT_NOT_ALLOWED",
      "Test recipient is not in EMAIL_TEST_ALLOWLIST.",
      403
    );
  const campaign = await campaignForRendering(id);
  if (!campaign || campaign.version !== version)
    throw new DomainError(
      "CAMPAIGN_VERSION_CONFLICT",
      "Test send must use the current campaign version.",
      409
    );
  const snapshot = snapshotFromCampaign(campaign);
  snapshot.content.subject = `[TEST] ${snapshot.content.subject}`;
  const testFullName = actorUser.displayName?.trim() || "Test Recipient";
  const rendered = await renderListingEmail({
    snapshot,
    recipient: {
      firstName: testFullName.split(/\s+/)[0] || "Test",
      fullName: testFullName,
      unsubscribeUrl: `${config.baseUrl}/unsubscribe?test=1`,
    },
    templateKey: campaign.templateKey,
  });
  const recipientHash = createHash("sha256").update(email).digest("hex");
  const idempotencyKey = `test/${campaign.id}/version/${campaign.version}/actor/${actor.userId}/recipient/${recipientHash}/request/${clientRequestId}`;
  const existing = await prisma.testSendRecord.findUnique({ where: { idempotencyKey } });
  if (existing?.success)
    return { accepted: true, providerEmailId: existing.providerEmailId, duplicate: true };
  const result = await getEmailProvider().sendSingle(
    {
      from: `${snapshot.sender.fromName} <${snapshot.sender.fromEmail}>`,
      to: email,
      replyTo: snapshot.sender.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: { "X-Homix-Test": "true" },
      tags: [
        { name: "campaign_id", value: campaign.id },
        { name: "test", value: "true" },
      ],
    },
    { idempotencyKey }
  );
  await inTransaction(async (tx) => {
    await tx.testSendRecord.upsert({
      where: { idempotencyKey },
      create: {
        campaignId: id,
        campaignVersion: version,
        recipientMasked: maskEmail(email),
        templateVersion: snapshot.templateVersion,
        providerEmailId: result.providerEmailId,
        success: result.accepted,
        idempotencyKey,
        clientRequestId,
        createdByUserId: actor.userId,
      },
      update: {
        providerEmailId: result.providerEmailId,
        success: result.accepted,
      },
    });
    if (result.accepted)
      await tx.campaign.update({
        where: { id },
        data: { lastSuccessfulTestAt: new Date(), lastTestedVersion: version },
      });
    await writeAudit(tx, actor, {
      action: "campaign.test_send",
      entityType: "campaign",
      entityId: id,
      after: { success: result.accepted, recipient: maskEmail(email), version },
    });
  });
  if (!result.accepted)
    throw new DomainError(
      "TEST_SEND_FAILED",
      result.message ?? "Provider rejected the test send.",
      502,
      { code: result.code }
    );
  return { accepted: true, providerEmailId: result.providerEmailId, duplicate: false };
}

export async function snapshotCampaign(
  id: string,
  actor: ActorContext,
  expectedVersion: number,
  scheduledAt?: Date,
  clientIdempotencyKey?: string
) {
  const queued = await prisma.$transaction(
    async (tx) => {
      const keySuffix =
        clientIdempotencyKey?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "default";
      const uniqueKey = `DISPATCH_CAMPAIGN/${id}/${keySuffix}`;
      await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${id}::uuid FOR UPDATE`;
      const campaign = await campaignForRendering(id, tx);
      if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
      if (campaign.version !== expectedVersion)
        throw new DomainError(
          "CAMPAIGN_VERSION_CONFLICT",
          "Campaign was changed before it could be queued.",
          409,
          { currentVersion: campaign.version }
        );
      const priorJob = await tx.job.findUnique({ where: { uniqueKey } });
      if (
        priorJob &&
        new Set<CampaignStatus>([
          CampaignStatus.SCHEDULED,
          CampaignStatus.QUEUED,
          CampaignStatus.SENDING,
        ]).has(campaign.status)
      )
        return campaign;
      if (
        campaign.status !== CampaignStatus.READY &&
        campaign.status !== CampaignStatus.SNAPSHOTTING
      )
        throw new DomainError(
          "CAMPAIGN_INVALID_STATE",
          "Campaign must be READY before scheduling.",
          409
        );
      const snapshot = snapshotFromCampaign(campaign);
      if (config.deliveryMode === "live") assertLiveReady(campaign, snapshot);
      if (campaign.status === CampaignStatus.READY)
        await tx.campaign.update({ where: { id }, data: { status: "SNAPSHOTTING" } });
      const filter = audienceFilterSchema.parse(campaign.audienceFilter);
      const contacts = await resolveAudienceContacts(tx, filter);
      if (contacts.length === 0)
        throw new DomainError("AUDIENCE_EMPTY", "Campaign audience has no matching contacts.", 409);
      const suppressions = await tx.suppression.findMany({
        where: {
          isActive: true,
          emailNormalized: { in: contacts.map((contact) => contact.emailNormalized) },
        },
      });
      const suppressedByEmail = new Map(
        suppressions.map((suppression) => [suppression.emailNormalized, suppression.reason])
      );
      const previouslySentContactIds =
        filter.excludePreviouslySentListing && campaign.listingId
          ? new Set(
              (
                await tx.campaignRecipient.findMany({
                  where: {
                    contactId: { in: contacts.map((contact) => contact.id) },
                    sendState: "ACCEPTED",
                    campaign: { listingId: campaign.listingId, id: { not: id } },
                  },
                  select: { contactId: true },
                })
              ).flatMap((item) => (item.contactId ? [item.contactId] : []))
            )
          : new Set<string>();
      const recipients = contacts.map((contact) => {
        const recipientId = randomUUID();
        const token = createUnsubscribeToken(recipientId, config.unsubscribeSigningSecret);
        const suppressionReason = suppressedByEmail.get(contact.emailNormalized);
        const unknownPermission =
          (filter.requireKnownPermissionBasis ?? true) && contact.permissionBasis === "UNKNOWN";
        const previouslySent = previouslySentContactIds.has(contact.id);
        return {
          id: recipientId,
          campaignId: id,
          contactId: contact.id,
          email: contact.email,
          emailNormalized: contact.emailNormalized,
          firstName: contact.firstName,
          lastName: contact.lastName,
          displayName: contact.displayName,
          company: contact.company,
          unsubscribeTokenHash: hashUnsubscribeToken(token),
          sendState:
            suppressionReason || unknownPermission || previouslySent
              ? ("SUPPRESSED" as const)
              : ("PENDING" as const),
          suppressionReason,
          lastErrorCode: unknownPermission
            ? "unknown_permission_basis"
            : previouslySent
              ? "previous_listing_send"
              : null,
        };
      });
      for (let offset = 0; offset < recipients.length; offset += 1_000)
        await tx.campaignRecipient.createMany({
          data: recipients.slice(offset, offset + 1_000),
          skipDuplicates: true,
        });
      const eligibleCount = recipients.filter((item) => item.sendState === "PENDING").length;
      const nextStatus =
        scheduledAt && scheduledAt > new Date() ? CampaignStatus.SCHEDULED : CampaignStatus.QUEUED;
      const unknownPermissionCount = recipients.filter(
        (item) => item.lastErrorCode === "unknown_permission_basis"
      ).length;
      const previouslySentCount = recipients.filter(
        (item) => item.lastErrorCode === "previous_listing_send"
      ).length;
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          status: nextStatus,
          scheduledAt,
          contentSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          audienceSnapshotSummary: {
            matched: recipients.length,
            eligible: eligibleCount,
            suppressed: recipients.length - eligibleCount,
            unknownPermission: unknownPermissionCount,
            previouslySent: previouslySentCount,
          },
          targetCount: recipients.length,
          eligibleCount,
          suppressedCount: recipients.length - eligibleCount,
        },
      });
      await tx.job.create({
        data: {
          type: "DISPATCH_CAMPAIGN",
          uniqueKey,
          payload: { campaignId: id },
          runAt: scheduledAt ?? new Date(),
        },
      });
      await writeAudit(tx, actor, {
        action: scheduledAt ? "campaign.schedule" : "campaign.send_now",
        entityType: "campaign",
        entityId: id,
        after: {
          targetCount: recipients.length,
          eligibleCount,
          scheduledAt: scheduledAt?.toISOString() ?? null,
        },
      });
      return updated;
    },
    { isolationLevel: "Serializable", maxWait: 5_000, timeout: 120_000 }
  );
  logger.info(
    {
      event: "campaign_queued",
      campaignId: id,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      targetCount: queued.targetCount,
      eligibleCount: queued.eligibleCount,
    },
    "Campaign snapshot queued"
  );
  return queued;
}

export async function queueCampaignSnapshot(
  id: string,
  actor: ActorContext,
  expectedVersion: number,
  scheduledAt?: Date,
  clientIdempotencyKey?: string
) {
  const keySuffix = clientIdempotencyKey?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "default";
  const uniqueKey = `SNAPSHOT_CAMPAIGN/${id}/${keySuffix}`;
  return inTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${id}::uuid FOR UPDATE`;
    const campaign = await campaignForRendering(id, tx);
    if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    if (campaign.version !== expectedVersion)
      throw new DomainError(
        "CAMPAIGN_VERSION_CONFLICT",
        "Campaign was changed before it could be queued.",
        409,
        { currentVersion: campaign.version }
      );
    const priorJob = await tx.job.findUnique({ where: { uniqueKey } });
    if (priorJob && campaign.status === CampaignStatus.SNAPSHOTTING) return campaign;
    if (campaign.status !== CampaignStatus.READY)
      throw new DomainError(
        "CAMPAIGN_INVALID_STATE",
        "Campaign must be READY before scheduling.",
        409
      );
    const snapshot = snapshotFromCampaign(campaign);
    if (config.deliveryMode === "live") assertLiveReady(campaign, snapshot);
    const updated = await tx.campaign.update({
      where: { id },
      data: { status: "SNAPSHOTTING" },
    });
    const payload = {
      campaignId: id,
      expectedVersion,
      scheduledAt: scheduledAt?.toISOString(),
      clientIdempotencyKey: keySuffix,
      actor: {
        userId: actor.userId,
        role: actor.role,
        requestId: actor.requestId,
        maskedIp: actor.maskedIp,
        userAgent: actor.userAgent,
      },
    };
    await tx.job.upsert({
      where: { uniqueKey },
      create: {
        type: "SNAPSHOT_CAMPAIGN",
        uniqueKey,
        payload,
        maxAttempts: 3,
      },
      update: {
        payload,
        status: "PENDING",
        attempts: 0,
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        lastError: null,
        completedAt: null,
      },
    });
    await writeAudit(tx, actor, {
      action: "campaign.snapshot_queued",
      entityType: "campaign",
      entityId: id,
      after: { scheduledAt: scheduledAt?.toISOString() ?? null, expectedVersion },
    });
    return updated;
  });
}

export async function publishCampaign(
  id: string,
  actor: ActorContext,
  expectedVersion: number,
  scheduledAt: Date | undefined,
  clientIdempotencyKey: string
) {
  const keySuffix = clientIdempotencyKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  if (!keySuffix)
    throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.", 400);
  const uniqueKey = `SNAPSHOT_CAMPAIGN/${id}/${keySuffix}`;
  return inTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${id}::uuid FOR UPDATE`;
    let campaign = await campaignForRendering(id, tx);
    if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    const priorJob = await tx.job.findUnique({ where: { uniqueKey } });
    if (
      priorJob &&
      ["SNAPSHOTTING", "SCHEDULED", "QUEUED", "SENDING", "COMPLETED"].includes(campaign.status)
    )
      return campaign;
    if (campaign.version !== expectedVersion)
      throw new DomainError(
        "CAMPAIGN_VERSION_CONFLICT",
        "Campaign was changed before it could be sent.",
        409,
        { currentVersion: campaign.version }
      );
    if (!campaign.listingId)
      throw new DomainError("CAMPAIGN_LISTING_REQUIRED", "Choose a property before sending.", 409);
    if (campaign.lastTestedVersion !== campaign.version || !campaign.lastSuccessfulTestAt)
      throw new DomainError(
        "CURRENT_TEST_SEND_REQUIRED",
        "Send a successful test for the current email before continuing.",
        409
      );
    if (campaign.status !== CampaignStatus.DRAFT && campaign.status !== CampaignStatus.READY)
      throw new DomainError(
        "CAMPAIGN_INVALID_STATE",
        "Only a draft or ready email can be sent.",
        409
      );
    if (
      campaign.listing?.status === "DRAFT" &&
      campaign.listing.assets.some(
        (asset) => asset.kind === "HERO" && asset.isEmailSafe && !asset.deletedAt
      ) &&
      (campaign.listing.listingUrl || config.companyListingsUrl)
    ) {
      await tx.listing.update({
        where: { id: campaign.listing.id },
        data: { status: "ACTIVE", publishedAt: new Date(), updatedByUserId: actor.userId },
      });
      await writeAudit(tx, actor, {
        action: "listing.activated_for_publish",
        entityType: "listing",
        entityId: campaign.listing.id,
        after: { campaignId: id },
      });
      campaign = await campaignForRendering(id, tx);
      if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    }
    const audienceFilter = audienceFilterSchema.parse(campaign.audienceFilter);
    const audienceContacts = await resolveAudienceContacts(tx, audienceFilter);
    const activeSuppressions = audienceContacts.length
      ? await tx.suppression.findMany({
          where: {
            isActive: true,
            emailNormalized: { in: audienceContacts.map((contact) => contact.emailNormalized) },
          },
          select: { emailNormalized: true },
        })
      : [];
    const suppressedEmails = new Set(
      activeSuppressions.map((suppression) => suppression.emailNormalized)
    );
    const previouslySentContactIds =
      audienceFilter.excludePreviouslySentListing && campaign.listingId && audienceContacts.length
        ? new Set(
            (
              await tx.campaignRecipient.findMany({
                where: {
                  contactId: { in: audienceContacts.map((contact) => contact.id) },
                  sendState: "ACCEPTED",
                  campaign: { listingId: campaign.listingId, id: { not: id } },
                },
                select: { contactId: true },
              })
            ).flatMap((item) => (item.contactId ? [item.contactId] : []))
          )
        : new Set<string>();
    const eligibleContacts = audienceContacts.filter(
      (contact) =>
        !suppressedEmails.has(contact.emailNormalized) &&
        (!(audienceFilter.requireKnownPermissionBasis ?? true) ||
          contact.permissionBasis !== "UNKNOWN") &&
        !previouslySentContactIds.has(contact.id)
    );
    if (!eligibleContacts.length)
      throw new DomainError(
        "AUDIENCE_EMPTY",
        "No eligible recipients remain after permission, suppression, and prior-send checks.",
        409
      );
    const snapshot = snapshotFromCampaign(campaign);
    if (config.deliveryMode === "live") assertLiveReady(campaign, snapshot);
    const updated = await tx.campaign.update({
      where: { id },
      data: { status: "SNAPSHOTTING" },
    });
    const payload = {
      campaignId: id,
      expectedVersion,
      scheduledAt: scheduledAt?.toISOString(),
      clientIdempotencyKey: keySuffix,
      actor: {
        userId: actor.userId,
        role: actor.role,
        requestId: actor.requestId,
        maskedIp: actor.maskedIp,
        userAgent: actor.userAgent,
      },
    };
    await tx.job.upsert({
      where: { uniqueKey },
      create: { type: "SNAPSHOT_CAMPAIGN", uniqueKey, payload, maxAttempts: 3 },
      update: {
        payload,
        status: "PENDING",
        attempts: 0,
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        lastError: null,
        completedAt: null,
      },
    });
    await writeAudit(tx, actor, {
      action: "campaign.publish",
      entityType: "campaign",
      entityId: id,
      after: { scheduledAt: scheduledAt?.toISOString() ?? null, expectedVersion },
    });
    return updated;
  });
}

export async function transitionCampaign(
  id: string,
  action: "pause" | "resume" | "cancel",
  actor: ActorContext
) {
  const target =
    action === "pause"
      ? CampaignStatus.PAUSED
      : action === "resume"
        ? CampaignStatus.SENDING
        : CampaignStatus.CANCELLED;
  return inTransaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM campaigns WHERE id = ${id}::uuid FOR UPDATE
    `);
    const campaign = await tx.campaign.findUnique({ where: { id } });
    if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    assertCampaignTransition(campaign.status, target);
    const updated = await tx.campaign.update({ where: { id }, data: { status: target } });
    if (target === CampaignStatus.CANCELLED) {
      const retryBatches = await tx.sendBatch.findMany({
        where: { campaignId: id, status: "TEMPORARY_FAILED" },
        select: {
          id: true,
          senderProfileId: true,
          createdAt: true,
          senderProfile: { select: { timezone: true } },
        },
      });
      for (const batch of retryBatches) {
        const claimed = await tx.sendBatch.updateMany({
          where: { id: batch.id, status: "TEMPORARY_FAILED" },
          data: {
            status: "PERMANENT_FAILED",
            lastErrorCode: "campaign_cancelled",
            nextAttemptAt: null,
            completedAt: new Date(),
          },
        });
        if (claimed.count !== 1) continue;
        const released = await tx.campaignRecipient.updateMany({
          where: { sendBatchId: batch.id, sendState: "TEMPORARY_FAILED" },
          data: { sendState: "CANCELLED" },
        });
        if (released.count > 0) {
          await tx.sendBatch.update({
            where: { id: batch.id },
            data: { failedCount: released.count },
          });
          await tx.senderDailyUsage.updateMany({
            where: {
              senderProfileId: batch.senderProfileId,
              localDate: localDate(batch.createdAt, batch.senderProfile.timezone),
              reservedCount: { gte: released.count },
            },
            data: {
              reservedCount: { decrement: released.count },
              releasedCount: { increment: released.count },
            },
          });
        }
      }
      await tx.campaignRecipient.updateMany({
        where: { campaignId: id, sendState: { in: ["PENDING", "TEMPORARY_FAILED", "RESERVED"] } },
        data: { sendState: "CANCELLED" },
      });
    }
    if (target === CampaignStatus.SENDING)
      await tx.job.upsert({
        where: { uniqueKey: `DISPATCH_CAMPAIGN/${id}/resume` },
        create: {
          type: "DISPATCH_CAMPAIGN",
          uniqueKey: `DISPATCH_CAMPAIGN/${id}/resume`,
          payload: { campaignId: id },
        },
        update: {
          status: "PENDING",
          runAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
        },
      });
    await writeAudit(tx, actor, {
      action: `campaign.${action}`,
      entityType: "campaign",
      entityId: id,
    });
    return updated;
  });
}
