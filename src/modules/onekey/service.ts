import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { config } from "../../config/index.js";
import { prisma } from "../../db/prisma.js";
import { processAndStoreAsset } from "../assets/service.js";
import type { ActorContext } from "../audit/service.js";
import { writeAudit } from "../audit/service.js";
import { summarizePublicRemarks } from "./remarks.js";
import {
  getOneKeyProvider,
  type OneKeyListing,
  type OneKeyListingAgent,
} from "../../integrations/onekey/index.js";
import { isAllowedOneKeyMediaUrl } from "../../integrations/onekey/mediaPolicy.js";
import { normalizeAddress } from "../../integrations/onekey/normalize.js";
import { DomainError } from "../../shared/errors.js";
import { normalizeEmail } from "../../shared/normalize.js";
import { createAssetStorage } from "../../storage/index.js";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sourceFacts(item: OneKeyListing) {
  return {
    listingKey: item.sourceKey,
    listingId: item.listingId,
    standardStatus: item.standardStatus,
    address: item.unparsedAddress,
    city: item.city,
    stateCode: item.stateCode,
    postalCode: item.postalCode,
    county: item.county,
    propertyType: item.propertyType,
    propertySubType: item.propertySubType,
    listPrice: item.listPrice,
    bedroomsTotal: item.bedroomsTotal,
    bathroomsTotalInteger: item.bathroomsTotalInteger,
    livingArea: item.livingArea,
    yearBuilt: item.yearBuilt,
    publicRemarks: item.publicRemarks,
    listAgentFullName: item.listAgentFullName,
    listOfficeName: item.listOfficeName,
    modificationTimestamp: item.modificationTimestamp,
    imageCount: item.imageUrls.length,
  };
}

export async function cacheOneKeyListing(item: OneKeyListing) {
  return prisma.oneKeyListingIndex.upsert({
    where: { sourceKey: item.sourceKey },
    create: {
      sourceKey: item.sourceKey,
      listingId: item.listingId,
      normalizedAddress: normalizeAddress(item.unparsedAddress),
      unparsedAddress: item.unparsedAddress,
      city: item.city,
      stateCode: item.stateCode,
      postalCode: item.postalCode,
      county: item.county,
      standardStatus: item.standardStatus,
      propertyType: item.propertyType,
      propertySubType: item.propertySubType,
      listPrice: item.listPrice,
      bedroomsTotal: item.bedroomsTotal,
      bathroomsTotalInteger: item.bathroomsTotalInteger,
      livingArea: item.livingArea,
      yearBuilt: item.yearBuilt,
      publicRemarks: item.publicRemarks,
      listAgentFullName: item.listAgentFullName,
      listOfficeName: item.listOfficeName,
      imageUrls: item.imageUrls,
      sourceModifiedAt: item.modificationTimestamp ? new Date(item.modificationTimestamp) : null,
      sourceSnapshot: json(item.raw),
    },
    update: {
      listingId: item.listingId,
      normalizedAddress: normalizeAddress(item.unparsedAddress),
      unparsedAddress: item.unparsedAddress,
      city: item.city,
      stateCode: item.stateCode,
      postalCode: item.postalCode,
      county: item.county,
      standardStatus: item.standardStatus,
      propertyType: item.propertyType,
      propertySubType: item.propertySubType,
      listPrice: item.listPrice,
      bedroomsTotal: item.bedroomsTotal,
      bathroomsTotalInteger: item.bathroomsTotalInteger,
      livingArea: item.livingArea,
      yearBuilt: item.yearBuilt,
      publicRemarks: item.publicRemarks,
      listAgentFullName: item.listAgentFullName,
      listOfficeName: item.listOfficeName,
      imageUrls: item.imageUrls,
      sourceModifiedAt: item.modificationTimestamp ? new Date(item.modificationTimestamp) : null,
      sourceSnapshot: json(item.raw),
      syncedAt: new Date(),
    },
  });
}

function indexedToListing(item: Awaited<ReturnType<typeof cacheOneKeyListing>>): OneKeyListing {
  return {
    sourceKey: item.sourceKey,
    listingId: item.listingId ?? undefined,
    standardStatus: item.standardStatus ?? undefined,
    unparsedAddress: item.unparsedAddress,
    city: item.city,
    stateCode: item.stateCode,
    postalCode: item.postalCode,
    county: item.county ?? undefined,
    propertyType: item.propertyType ?? undefined,
    propertySubType: item.propertySubType ?? undefined,
    listPrice: item.listPrice ? Number(item.listPrice) : undefined,
    bedroomsTotal: item.bedroomsTotal ?? undefined,
    bathroomsTotalInteger: item.bathroomsTotalInteger ?? undefined,
    livingArea: item.livingArea ? Number(item.livingArea) : undefined,
    yearBuilt: item.yearBuilt ?? undefined,
    publicRemarks: item.publicRemarks ?? undefined,
    listAgentFullName: item.listAgentFullName ?? undefined,
    listOfficeName: item.listOfficeName ?? undefined,
    modificationTimestamp: item.sourceModifiedAt?.toISOString(),
    imageUrls: item.imageUrls,
    raw: item.sourceSnapshot as Record<string, unknown>,
  };
}

export async function searchOneKeyListings(queryInput: string, limit = 20) {
  const query = queryInput.trim();
  if (query.length < 2 || query.length > 200)
    throw new DomainError("ONEKEY_SEARCH_INVALID", "Enter 2–200 characters to search.");
  const normalized = normalizeAddress(query);
  const local = await prisma.oneKeyListingIndex.findMany({
    where: {
      OR: [
        { sourceKey: { equals: query, mode: "insensitive" } },
        { listingId: { equals: query, mode: "insensitive" } },
        { normalizedAddress: { contains: normalized } },
      ],
    },
    take: limit,
    orderBy: [{ sourceModifiedAt: "desc" }, { sourceKey: "asc" }],
  });
  let providerUsed = false;
  if (local.length === 0 && config.oneKeyProvider !== "disabled") {
    const remote = await getOneKeyProvider().search({ query, limit, offset: 0 });
    await Promise.all(remote.map(cacheOneKeyListing));
    providerUsed = true;
  }
  const items = await prisma.oneKeyListingIndex.findMany({
    where: {
      OR: [
        { sourceKey: { equals: query, mode: "insensitive" } },
        { listingId: { equals: query, mode: "insensitive" } },
        { normalizedAddress: { contains: normalized } },
      ],
    },
    take: limit,
    orderBy: [{ sourceModifiedAt: "desc" }, { sourceKey: "asc" }],
  });
  const imported = await prisma.listing.findMany({
    where: { source: "ONEKEY", sourceKey: { in: items.map((item) => item.sourceKey) } },
    select: { id: true, sourceKey: true },
  });
  const importedByKey = new Map(imported.map((item) => [item.sourceKey, item.id]));
  return {
    items: items.map((item) => ({ ...item, importedListingId: importedByKey.get(item.sourceKey) })),
    source: providerUsed ? "local+provider" : "local",
  };
}

async function loadOneKeyListing(sourceKey: string, refresh: boolean) {
  const local = await prisma.oneKeyListingIndex.findUnique({ where: { sourceKey } });
  if (!refresh && local) return indexedToListing(local);
  if (config.oneKeyProvider === "disabled") {
    if (local) return indexedToListing(local);
    throw new DomainError("ONEKEY_DISABLED", "OneKey integration is disabled.", 409);
  }
  const item = await getOneKeyProvider().getBySourceKey(sourceKey);
  await cacheOneKeyListing(item);
  return item;
}

export async function getOneKeyListingReview(sourceKey: string) {
  const item = await loadOneKeyListing(sourceKey, false);
  const imported = await prisma.listing.findUnique({
    where: { source_sourceKey: { source: "ONEKEY", sourceKey } },
    include: { assets: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
  });
  return { sourceFacts: sourceFacts(item), imported };
}

export async function previewOneKeyRecipients(
  sourceKey: string,
  input: { nearbyZipCount: number; closedMonths: number; limit: number }
) {
  return getOneKeyProvider().getRecipientCandidates(sourceKey, input);
}

function propertyType(value?: string) {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("residential")) return "RESIDENTIAL" as const;
  if (normalized.includes("multi")) return "MULTIFAMILY" as const;
  if (normalized.includes("land")) return "LAND" as const;
  if (normalized.includes("office")) return "OFFICE" as const;
  if (normalized.includes("retail")) return "RETAIL" as const;
  if (normalized.includes("industrial")) return "INDUSTRIAL" as const;
  if (normalized.includes("hospitality")) return "HOSPITALITY" as const;
  return "OTHER" as const;
}

function listingSlug(item: OneKeyListing) {
  const suffix = (item.listingId ?? item.sourceKey).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `onekey-${suffix}`.slice(0, 160).replace(/-$/, "");
}

function addressLine(item: OneKeyListing) {
  const suffix = new RegExp(
    `,?\\s*${item.city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*${item.stateCode}\\s+${item.postalCode}.*$`,
    "i"
  );
  return (
    item.unparsedAddress.replace(suffix, "").replace(/,\s*$/, "").trim() || item.unparsedAddress
  );
}

async function resolveImportAgent(requestedAgentId: string) {
  const selected = await prisma.agent.findUnique({ where: { id: requestedAgentId } });
  if (!selected || !selected.isActive)
    throw new DomainError(
      "LISTING_AGENT_NOT_FOUND",
      "Choose an active Homix listing agent before importing this property.",
      409
    );
  return selected;
}

function sourceAgentNames(contact: OneKeyListingAgent) {
  const fullName = contact.fullName.trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    fullName,
    firstName: contact.firstName?.trim() || parts[0] || fullName,
    lastName: contact.lastName?.trim() || parts.slice(1).join(" "),
  };
}

function safeAgentHeadshot(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function syncOneKeyListingAgent(sourceKey: string, actor: ActorContext) {
  const contact = await getOneKeyProvider().getListingAgent(sourceKey);
  const emailNormalized = normalizeEmail(contact.email);
  const names = sourceAgentNames(contact);
  const sourceSystem = "bbo-onekey";

  return prisma.$transaction(async (tx) => {
    const [bySource, byEmail] = await Promise.all([
      tx.agent.findUnique({
        where: {
          sourceSystem_sourceAgentKey: {
            sourceSystem,
            sourceAgentKey: contact.memberKey,
          },
        },
      }),
      tx.agent.findUnique({ where: { emailNormalized } }),
    ]);
    if (bySource && byEmail && bySource.id !== byEmail.id)
      throw new DomainError(
        "ONEKEY_AGENT_IDENTITY_CONFLICT",
        "The OneKey listing agent email is already assigned to a different local agent.",
        409
      );
    if (
      byEmail?.sourceSystem &&
      (byEmail.sourceSystem !== sourceSystem || byEmail.sourceAgentKey !== contact.memberKey)
    )
      throw new DomainError(
        "ONEKEY_AGENT_IDENTITY_CONFLICT",
        "The OneKey listing agent identity conflicts with an existing synchronized agent.",
        409
      );

    const existing = bySource ?? byEmail;
    const data = {
      firstName: names.firstName,
      lastName: names.lastName,
      displayName: names.fullName,
      email: contact.email.trim(),
      emailNormalized,
      phone:
        contact.phone?.trim() || contact.mobilePhone?.trim() || contact.directPhone?.trim() || null,
      licenseNumber: contact.stateLicense?.trim() || null,
      headshotUrl: safeAgentHeadshot(contact.headshotUrl),
      sourceSystem,
      sourceAgentKey: contact.memberKey,
      sourceMlsId: contact.memberMlsId?.trim() || null,
      sourceSyncedAt: new Date(),
      isActive: true,
    };
    const agent = existing
      ? await tx.agent.update({ where: { id: existing.id }, data })
      : await tx.agent.create({ data });
    await writeAudit(tx, actor, {
      action: existing ? "onekey.agent_sync" : "onekey.agent_import",
      entityType: "agent",
      entityId: agent.id,
      before: existing
        ? { sourceAgentKey: existing.sourceAgentKey, displayName: existing.displayName }
        : undefined,
      after: {
        sourceSystem,
        sourceAgentKey: contact.memberKey,
        sourceMlsId: contact.memberMlsId,
        displayName: names.fullName,
      },
    });
    return agent;
  });
}

export async function importOneKeyListing(
  sourceKey: string,
  requestedAgentId: string | undefined,
  actor: ActorContext
) {
  const item = await loadOneKeyListing(sourceKey, true);
  const agent = requestedAgentId
    ? await resolveImportAgent(requestedAgentId)
    : await syncOneKeyListingAgent(sourceKey, actor);
  const facts = sourceFacts(item);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.listing.findUnique({
      where: { source_sourceKey: { source: "ONEKEY", sourceKey: item.sourceKey } },
    });
    if (existing) {
      if (existing.agentId !== agent.id) {
        const listing = await tx.listing.update({
          where: { id: existing.id },
          data: { agentId: agent.id, updatedByUserId: actor.userId },
        });
        await tx.campaign.updateMany({
          where: { listingId: existing.id, status: "DRAFT" },
          data: {
            replyToAgentId: agent.id,
            version: { increment: 1 },
            lastSuccessfulTestAt: null,
            lastTestedVersion: null,
          },
        });
        await writeAudit(tx, actor, {
          action: "onekey.listing_agent_reconciled",
          entityType: "listing",
          entityId: existing.id,
          before: { agentId: existing.agentId },
          after: { agentId: agent.id, listAgentFullName: item.listAgentFullName },
        });
        return { listing, created: false };
      }
      return { listing: existing, created: false };
    }
    const listing = await tx.listing.create({
      data: {
        internalName: `OneKey ${item.listingId ?? item.sourceKey}`,
        title: addressLine(item),
        slug: listingSlug(item),
        status: "DRAFT",
        transactionType: "FOR_SALE",
        propertyType: propertyType(item.propertyType),
        addressLine1: addressLine(item),
        city: item.city,
        stateCode: item.stateCode,
        postalCode: item.postalCode,
        county: item.county,
        askingPrice: item.listPrice,
        priceUponRequest: !item.listPrice,
        buildingSqFt: item.livingArea ? Math.round(item.livingArea) : null,
        yearBuilt: item.yearBuilt,
        shortDescription: summarizePublicRemarks(item.publicRemarks),
        longDescription: item.publicRemarks,
        highlights: [],
        listingUrl: config.companyListingsUrl,
        externalId: item.sourceKey,
        mlsId: item.listingId,
        isExclusive: false,
        facts: json(facts),
        source: "ONEKEY",
        sourceKey: item.sourceKey,
        sourceListingId: item.listingId,
        sourceSystem: "onekey2-via-bbo",
        sourceModifiedAt: item.modificationTimestamp ? new Date(item.modificationTimestamp) : null,
        sourceSyncedAt: new Date(),
        sourceSyncStatus: "CURRENT",
        sourceSnapshot: json(item.raw),
        agentId: agent.id,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
    await tx.job.create({
      data: {
        type: "ONEKEY_MEDIA_IMPORT",
        uniqueKey: `ONEKEY_MEDIA_IMPORT/${listing.id}/${item.modificationTimestamp ?? "initial"}`,
        payload: { listingId: listing.id },
        maxAttempts: 5,
      },
    });
    await writeAudit(tx, actor, {
      action: "onekey.listing_import",
      entityType: "listing",
      entityId: listing.id,
      after: { sourceKey: item.sourceKey, listingId: item.listingId, ownershipGate: false },
    });
    return { listing, created: true };
  });
  return result;
}

export async function refreshOneKeyListing(listingId: string, actor: ActorContext) {
  const before = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!before || before.source !== "ONEKEY" || !before.sourceKey)
    throw new DomainError("ONEKEY_LISTING_NOT_FOUND", "Imported OneKey listing not found.", 404);
  try {
    const item = await loadOneKeyListing(before.sourceKey, true);
    const agent = await syncOneKeyListingAgent(before.sourceKey, actor);
    const changed = Object.entries(sourceFacts(item))
      .filter(
        ([key, value]) =>
          JSON.stringify((before.facts as Record<string, unknown> | null)?.[key]) !==
          JSON.stringify(value)
      )
      .map(([key]) => key);
    const updated = await prisma.$transaction(async (tx) => {
      const listing = await tx.listing.update({
        where: { id: listingId },
        data: {
          facts: json(sourceFacts(item)),
          sourceListingId: item.listingId,
          sourceModifiedAt: item.modificationTimestamp
            ? new Date(item.modificationTimestamp)
            : null,
          sourceSyncedAt: new Date(),
          sourceSyncStatus: "CURRENT",
          sourceSnapshot: json(item.raw),
          sourceWarnings: Prisma.JsonNull,
          agentId: agent.id,
          updatedByUserId: actor.userId,
        },
      });
      if (before.agentId !== agent.id)
        await tx.campaign.updateMany({
          where: { listingId, status: "DRAFT" },
          data: {
            replyToAgentId: agent.id,
            version: { increment: 1 },
            lastSuccessfulTestAt: null,
            lastTestedVersion: null,
          },
        });
      await writeAudit(tx, actor, {
        action: "onekey.listing_refresh",
        entityType: "listing",
        entityId: listing.id,
        after: {
          changedSourceFields: changed,
          marketingOverridesPreserved: true,
          agentId: agent.id,
          previousAgentId: before.agentId,
        },
      });
      return listing;
    });
    return { listing: updated, changedSourceFields: changed };
  } catch (error) {
    await prisma.listing.update({
      where: { id: listingId },
      data: { sourceSyncStatus: "FAILED", sourceWarnings: { refresh: "Provider refresh failed" } },
    });
    throw error;
  }
}

export async function importOneKeyRecipients(
  listingId: string,
  input: { nearbyZipCount: number; closedMonths: number; limit: number; audienceName?: string },
  actor: ActorContext
) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.source !== "ONEKEY" || !listing.sourceKey)
    throw new DomainError("ONEKEY_LISTING_NOT_FOUND", "Imported OneKey listing not found.", 404);
  const candidates = await getOneKeyProvider().getRecipientCandidates(listing.sourceKey, input);
  const result = await prisma.$transaction(
    async (tx) => {
      const preparedContacts = candidates.recipients.map((candidate) => {
        const emailNormalized = normalizeEmail(candidate.email);
        return {
          candidate,
          emailNormalized,
          matching: {
            sourceListingKey: listing.sourceKey,
            sourceListingId: listing.sourceListingId,
            selectionPolicy: candidates.selectionPolicy,
            matchedTransactionSides: candidate.matchedTransactionSides,
            matchedZipCount: candidate.matchedZipCount,
            nearestDistanceKm: candidate.nearestDistanceKm,
            matchedSameZip: candidate.matchedSameZip,
            representedSeller: candidate.representedSeller,
            representedBuyer: candidate.representedBuyer,
            memberKey: candidate.memberKey,
            memberMlsId: candidate.memberMlsId,
            officeKey: candidate.officeKey,
          },
        };
      });
      const normalizedEmails = preparedContacts.map((item) => item.emailNormalized);
      const existingContacts = await tx.contact.findMany({
        where: { emailNormalized: { in: normalizedEmails } },
        select: { id: true, emailNormalized: true },
      });
      const existingEmails = new Set(existingContacts.map((item) => item.emailNormalized));
      const missingContacts = preparedContacts.filter(
        (item) => !existingEmails.has(item.emailNormalized)
      );
      if (missingContacts.length)
        await tx.contact.createMany({
          data: missingContacts.map(({ candidate, emailNormalized, matching }) => ({
            email: candidate.email,
            emailNormalized,
            displayName: candidate.fullName,
            company: candidate.officeName,
            contactType: "BROKER",
            sourceType: "MLS_AGENT_MATCH",
            sourceDetail: `OneKey recent Closed match for ${listing.sourceKey}`,
            sourceReference: listing.sourceKey,
            permissionBasis: "BUSINESS_CONTACT",
            permissionCapturedAt: new Date(),
            customFields: json({ oneKeyMarketingMatch: matching }),
          })),
          skipDuplicates: true,
        });
      const matchedContacts = await tx.contact.findMany({
        where: { emailNormalized: { in: normalizedEmails } },
        select: { id: true, emailNormalized: true, permissionBasis: true },
      });
      const contactIds = matchedContacts.map((contact) => contact.id);
      const created = missingContacts.length;
      const updated = matchedContacts.length - created;
      const audience = await tx.savedAudience.create({
        data: {
          name: input.audienceName?.trim() || `${listing.title} · OneKey agent matches`,
          description: `${candidates.closedMonths} month Closed transactions in ${candidates.zipScope.map((item) => item.postalCode).join(", ")}`,
          filter: { includeContactIds: contactIds, requireKnownPermissionBasis: true },
          lastEstimatedCount: contactIds.length,
          lastEstimatedAt: new Date(),
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      const suppressed = await tx.suppression.count({
        where: {
          isActive: true,
          emailNormalized: {
            in: candidates.recipients.map((candidate) => normalizeEmail(candidate.email)),
          },
        },
      });
      await writeAudit(tx, actor, {
        action: "onekey.recipients_import",
        entityType: "listing",
        entityId: listing.id,
        after: {
          created,
          updated,
          suppressed,
          audienceId: audience.id,
          nearbyZipCount: input.nearbyZipCount,
          closedMonths: input.closedMonths,
        },
      });
      return { created, updated, suppressed, audience, contactIds };
    },
    { timeout: 120_000 }
  );
  return { ...result, selection: candidates };
}

export async function configureCampaignOneKeyRecipients(
  campaignId: string,
  input: {
    version: number;
    nearbyZipCount: number;
    closedMonths: number;
    limit: number;
    excludeEmailedWithinDays: number;
  },
  actor: ActorContext
) {
  const campaignRecord = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { listing: true },
  });
  const listing = campaignRecord?.listing;
  if (!campaignRecord) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
  if (campaignRecord.status !== "DRAFT")
    throw new DomainError("CAMPAIGN_LOCKED", "Only a draft email can be edited.", 409);
  if (campaignRecord.version !== input.version)
    throw new DomainError(
      "CAMPAIGN_VERSION_CONFLICT",
      "This email changed in another window.",
      409,
      { currentVersion: campaignRecord.version }
    );
  if (!listing || listing.source !== "ONEKEY" || !listing.sourceKey)
    throw new DomainError(
      "ONEKEY_LISTING_REQUIRED",
      "This recipient suggestion is available for OneKey properties.",
      409
    );
  const candidates = await getOneKeyProvider().getRecipientCandidates(listing.sourceKey, input);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${campaignId}::uuid FOR UPDATE`;
      const current = await tx.campaign.findUnique({ where: { id: campaignId } });
      if (!current) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
      if (current.status !== "DRAFT")
        throw new DomainError("CAMPAIGN_LOCKED", "Only a draft email can be edited.", 409);
      if (current.version !== input.version)
        throw new DomainError(
          "CAMPAIGN_VERSION_CONFLICT",
          "This email changed in another window.",
          409,
          { currentVersion: current.version }
        );

      const preparedContacts = candidates.recipients.map((candidate) => {
        const emailNormalized = normalizeEmail(candidate.email);
        return {
          candidate,
          emailNormalized,
          matching: {
            sourceListingKey: listing.sourceKey,
            sourceListingId: listing.sourceListingId,
            selectionPolicy: candidates.selectionPolicy,
            matchedTransactionSides: candidate.matchedTransactionSides,
            matchedZipCount: candidate.matchedZipCount,
            nearestDistanceKm: candidate.nearestDistanceKm,
            matchedSameZip: candidate.matchedSameZip,
            representedSeller: candidate.representedSeller,
            representedBuyer: candidate.representedBuyer,
            memberKey: candidate.memberKey,
            memberMlsId: candidate.memberMlsId,
            officeKey: candidate.officeKey,
          },
        };
      });
      const normalizedEmails = preparedContacts.map((item) => item.emailNormalized);
      const existingContacts = await tx.contact.findMany({
        where: { emailNormalized: { in: normalizedEmails } },
        select: { emailNormalized: true },
      });
      const existingEmails = new Set(existingContacts.map((item) => item.emailNormalized));
      const missingContacts = preparedContacts.filter(
        (item) => !existingEmails.has(item.emailNormalized)
      );
      if (missingContacts.length)
        await tx.contact.createMany({
          data: missingContacts.map(({ candidate, emailNormalized, matching }) => ({
            email: candidate.email,
            emailNormalized,
            displayName: candidate.fullName,
            company: candidate.officeName,
            contactType: "BROKER",
            sourceType: "MLS_AGENT_MATCH",
            sourceDetail: `OneKey recent Closed match for ${listing.sourceKey}`,
            sourceReference: listing.sourceKey,
            permissionBasis: "BUSINESS_CONTACT",
            permissionCapturedAt: new Date(),
            customFields: json({ oneKeyMarketingMatch: matching }),
          })),
          skipDuplicates: true,
        });
      const matchedContacts = await tx.contact.findMany({
        where: { emailNormalized: { in: normalizedEmails } },
        select: { id: true, emailNormalized: true, permissionBasis: true },
      });
      const contactIds = matchedContacts.map((contact) => contact.id);
      const created = missingContacts.length;
      const updated = matchedContacts.length - created;

      const filter = {
        includeContactIds: contactIds,
        requireKnownPermissionBasis: true,
        excludePreviouslySentListing: true,
        excludeEmailedWithinDays: input.excludeEmailedWithinDays,
      };
      const cutoff = new Date(Date.now() - input.excludeEmailedWithinDays * 86_400_000);
      const [suppressionRows, recentRows, previouslySentRows] = await Promise.all([
        tx.suppression.findMany({
          where: {
            isActive: true,
            emailNormalized: {
              in: candidates.recipients.map((candidate) => normalizeEmail(candidate.email)),
            },
          },
          select: { emailNormalized: true },
        }),
        tx.contact.findMany({
          where: { id: { in: contactIds }, lastSentAt: { gte: cutoff } },
          select: { id: true },
        }),
        tx.campaignRecipient.findMany({
          where: {
            contactId: { in: contactIds },
            sendState: "ACCEPTED",
            campaign: { listingId: listing.id, id: { not: campaignId } },
          },
          select: { contactId: true },
        }),
      ]);
      const suppressedEmails = new Set(suppressionRows.map((item) => item.emailNormalized));
      const recentIds = new Set(recentRows.map((item) => item.id));
      const previouslySentIds = new Set(
        previouslySentRows.flatMap((item) => (item.contactId ? [item.contactId] : []))
      );
      const suppressed = matchedContacts.filter((contact) =>
        suppressedEmails.has(contact.emailNormalized)
      ).length;
      const recentlyEmailed = recentIds.size;
      const ineligible = matchedContacts.filter(
        (contact) =>
          recentIds.has(contact.id) ||
          previouslySentIds.has(contact.id) ||
          suppressedEmails.has(contact.emailNormalized) ||
          contact.permissionBasis === "UNKNOWN"
      ).length;
      const eligible = Math.max(0, contactIds.length - ineligible);
      const previouslyContacted = previouslySentIds.size;
      const unknownPermission = matchedContacts.filter(
        (contact) => contact.permissionBasis === "UNKNOWN"
      ).length;
      const audience = await tx.savedAudience.create({
        data: {
          name: `${listing.title} · Suggested recipients`,
          description: `${candidates.closedMonths} month closed transactions across ${candidates.zipScope.length} ZIP codes`,
          filter,
          lastEstimatedCount: eligible,
          lastEstimatedAt: new Date(),
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      const campaign = await tx.campaign.update({
        where: { id: campaignId },
        data: {
          savedAudienceId: audience.id,
          audienceFilter: filter,
          version: { increment: 1 },
          lastSuccessfulTestAt: null,
          lastTestedVersion: null,
          updatedByUserId: actor.userId,
        },
        include: { listing: true, senderProfile: true, replyToAgent: true, savedAudience: true },
      });
      await writeAudit(tx, actor, {
        action: "campaign.onekey_nearby_recipients",
        entityType: "campaign",
        entityId: campaignId,
        after: {
          created,
          updated,
          matched: contactIds.length,
          eligible,
          suppressed,
          recentlyEmailed,
          previouslyContacted,
          audienceId: audience.id,
          criteria: input,
        },
      });
      return {
        campaign,
        audience,
        summary: {
          matched: contactIds.length,
          eligible,
          suppressed,
          recentlyEmailed,
          previouslyContacted,
          unknownPermission,
        },
        selection: candidates,
      };
    },
    { timeout: 120_000 }
  );
}

async function downloadMedia(url: string) {
  if (
    !isAllowedOneKeyMediaUrl(url, {
      nodeEnv: config.nodeEnv,
      provider: config.oneKeyProvider,
      bboListingApiBaseUrl: config.bboListingApiBaseUrl,
      allowedOrigins: config.oneKeyMediaAllowedOrigins,
    })
  )
    throw new Error("Media URL origin is not approved");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.aiRequestTimeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Media download returned ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 15 * 1024 * 1024) throw new Error("Media exceeds 15 MB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 15 * 1024 * 1024) throw new Error("Media exceeds 15 MB");
    return { buffer, contentType: response.headers.get("content-type")?.split(";", 1)[0] ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function importOneKeyMedia(listingId: string) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.source !== "ONEKEY" || !listing.sourceKey) return;
  const indexed = await prisma.oneKeyListingIndex.findUnique({
    where: { sourceKey: listing.sourceKey },
  });
  if (!indexed) throw new Error("OneKey index row is missing");
  const existing = await prisma.listingAsset.findMany({
    where: { listingId, deletedAt: null },
    select: { originalFileName: true, kind: true },
  });
  const seen = new Set(existing.map((asset) => asset.originalFileName).filter(Boolean));
  const storage = createAssetStorage();
  const warnings: string[] = [];
  let imported = 0;
  for (const sourceUrl of indexed.imageUrls.slice(0, config.oneKeyMediaLimit)) {
    const sourceRef = `onekey:${createHash("sha256").update(sourceUrl).digest("hex")}`;
    if (seen.has(sourceRef)) continue;
    try {
      const downloaded = await downloadMedia(sourceUrl);
      const processed = await processAndStoreAsset(storage, {
        buffer: downloaded.buffer,
        originalName: sourceRef,
        declaredMime: downloaded.contentType,
      });
      const hasHero = existing.some((asset) => asset.kind === "HERO") || imported > 0;
      await prisma.listingAsset.create({
        data: {
          listingId,
          kind: hasHero ? "GALLERY" : "HERO",
          blobName: processed.blobName,
          publicUrl: processed.publicUrl,
          thumbnailUrl: processed.thumbnailUrl,
          mimeType: processed.mimeType,
          byteSize: processed.byteSize,
          width: processed.width,
          height: processed.height,
          altText: `${listing.title} photo ${imported + 1}`,
          sortOrder: existing.length + imported,
          isEmailSafe: processed.isEmailSafe,
          originalFileName: sourceRef,
        },
      });
      imported += 1;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message.slice(0, 200) : "Media import failed");
    }
  }
  await prisma.listing.update({
    where: { id: listingId },
    data: {
      sourceWarnings: warnings.length ? { media: warnings } : Prisma.JsonNull,
      sourceSyncStatus: warnings.length && imported === 0 ? "FAILED" : "CURRENT",
    },
  });
  if (warnings.length && imported === 0) throw new Error("All OneKey media downloads failed");
}

export async function runOneKeyInitialSync() {
  const provider = getOneKeyProvider();
  await prisma.externalSyncCursor.upsert({
    where: { provider: provider.name },
    create: { provider: provider.name, lastStartedAt: new Date() },
    update: { lastStartedAt: new Date(), lastError: null },
  });
  let offset = 0;
  let count = 0;
  try {
    for (let page = 0; page < 100; page += 1) {
      const items = await provider.search({ query: "", limit: config.oneKeySyncPageSize, offset });
      await Promise.all(items.map(cacheOneKeyListing));
      count += items.length;
      offset += items.length;
      if (items.length < config.oneKeySyncPageSize) break;
    }
    await prisma.externalSyncCursor.update({
      where: { provider: provider.name },
      data: { cursor: String(offset), lastSucceededAt: new Date(), recordsSynced: count },
    });
  } catch (error) {
    await prisma.externalSyncCursor.update({
      where: { provider: provider.name },
      data: { lastError: error instanceof Error ? error.message.slice(0, 500) : "Sync failed" },
    });
    throw error;
  }
}

export async function runOneKeyDeltaSync() {
  const provider = getOneKeyProvider();
  if (!provider.changes) return runOneKeyInitialSync();
  const state = await prisma.externalSyncCursor.findUnique({ where: { provider: provider.name } });
  let cursor = state?.cursor ?? "0";
  let count = 0;
  for (let page = 0; page < 100; page += 1) {
    const changes = await provider.changes(cursor, config.oneKeySyncPageSize);
    for (const sourceKey of changes.sourceKeys) {
      await cacheOneKeyListing(await provider.getBySourceKey(sourceKey));
      count += 1;
    }
    cursor = changes.nextCursor;
    await prisma.externalSyncCursor.upsert({
      where: { provider: provider.name },
      create: {
        provider: provider.name,
        cursor,
        lastStartedAt: new Date(),
        lastSucceededAt: new Date(),
        recordsSynced: count,
      },
      update: {
        cursor,
        lastSucceededAt: new Date(),
        recordsSynced: { increment: changes.sourceKeys.length },
      },
    });
    if (!changes.hasMore) break;
  }
}
