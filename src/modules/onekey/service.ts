import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { config } from "../../config/index.js";
import { prisma } from "../../db/prisma.js";
import { processAndStoreAsset } from "../assets/service.js";
import type { ActorContext } from "../audit/service.js";
import { writeAudit } from "../audit/service.js";
import { getOneKeyProvider, type OneKeyListing } from "../../integrations/onekey/index.js";
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

export async function importOneKeyListing(sourceKey: string, agentId: string, actor: ActorContext) {
  const item = await loadOneKeyListing(sourceKey, true);
  const facts = sourceFacts(item);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.listing.findUnique({
      where: { source_sourceKey: { source: "ONEKEY", sourceKey: item.sourceKey } },
    });
    if (existing) return { listing: existing, created: false };
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
        shortDescription: item.publicRemarks?.slice(0, 1000),
        longDescription: item.publicRemarks,
        highlights: [],
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
        agentId,
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
          updatedByUserId: actor.userId,
        },
      });
      await writeAudit(tx, actor, {
        action: "onekey.listing_refresh",
        entityType: "listing",
        entityId: listing.id,
        after: { changedSourceFields: changed, marketingOverridesPreserved: true },
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
      const contactIds: string[] = [];
      let created = 0;
      let updated = 0;
      for (const candidate of candidates.recipients) {
        const emailNormalized = normalizeEmail(candidate.email);
        const existing = await tx.contact.findUnique({ where: { emailNormalized } });
        const matching = {
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
        };
        const contact = existing
          ? await tx.contact.update({
              where: { id: existing.id },
              data: {
                customFields: json({
                  ...((existing.customFields as Record<string, unknown> | null) ?? {}),
                  oneKeyMarketingMatch: matching,
                }),
              },
            })
          : await tx.contact.create({
              data: {
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
              },
            });
        if (existing) updated += 1;
        else created += 1;
        contactIds.push(contact.id);
      }
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
