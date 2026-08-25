import { prisma } from "../../db/prisma.js";
import { ListingStatus, PropertyType, TransactionType } from "@prisma/client";
import { z } from "zod";
import { inTransaction } from "../../db/transactions.js";
import { DomainError } from "../../shared/errors.js";
import { paginationSchema } from "../../shared/schemas.js";
import type { ActorContext } from "../audit/service.js";
import { writeAudit } from "../audit/service.js";
import { listingInputSchema, listingUpdateSchema } from "./schemas.js";

export async function listListings(query: unknown) {
  const page = paginationSchema
    .extend({
      status: z.enum(ListingStatus).optional(),
      propertyType: z.enum(PropertyType).optional(),
      transactionType: z.enum(TransactionType).optional(),
      agentId: z.uuid().optional(),
    })
    .parse(query);
  const where = {
    ...(page.search
      ? {
          OR: [
            { title: { contains: page.search, mode: "insensitive" as const } },
            { addressLine1: { contains: page.search, mode: "insensitive" as const } },
            { city: { contains: page.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(page.status ? { status: page.status } : {}),
    ...(page.propertyType ? { propertyType: page.propertyType } : {}),
    ...(page.transactionType ? { transactionType: page.transactionType } : {}),
    ...(page.agentId ? { agentId: page.agentId } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.listing.findMany({
      where,
      cursor: page.cursor ? { id: page.cursor } : undefined,
      skip: page.cursor ? 1 : (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        agent: true,
        assets: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
        _count: { select: { campaigns: true } },
      },
    }),
    prisma.listing.count({ where }),
  ]);
  return {
    items,
    total,
    page: page.page,
    limit: page.limit,
    nextCursor: items.length === page.limit ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function createListing(body: unknown, actor: ActorContext) {
  const input = listingInputSchema.parse(body);
  if (input.status === "ACTIVE")
    throw new DomainError(
      "LISTING_HERO_REQUIRED",
      "Create the listing as a draft, upload an email-safe hero image, then activate it.",
      409
    );
  return inTransaction(async (tx) => {
    const listing = await tx.listing.create({
      data: {
        ...input,
        askingPrice: input.askingPrice,
        lotSqFt: input.lotSqFt,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: "listing.create",
      entityType: "listing",
      entityId: listing.id,
      after: { title: listing.title, status: listing.status },
    });
    return listing;
  });
}

export async function updateListing(id: string, body: unknown, actor: ActorContext) {
  const input = listingUpdateSchema.parse(body);
  return inTransaction(async (tx) => {
    const before = await tx.listing.findUnique({
      where: { id },
      include: { assets: { where: { kind: "HERO", isEmailSafe: true, deletedAt: null } } },
    });
    if (!before) throw new DomainError("LISTING_NOT_FOUND", "Listing not found.", 404);
    const resultingTransactionType = input.transactionType ?? before.transactionType;
    const resultingAskingPrice =
      input.askingPrice === undefined ? before.askingPrice : input.askingPrice;
    const resultingPriceUponRequest = input.priceUponRequest ?? before.priceUponRequest;
    if (
      resultingTransactionType === "FOR_SALE" &&
      !resultingAskingPrice &&
      !resultingPriceUponRequest
    )
      throw new DomainError(
        "LISTING_PRICE_REQUIRED",
        "For-sale listings require a price or price-upon-request.",
        409
      );
    if (input.status === "ACTIVE" && before.assets.length === 0)
      throw new DomainError(
        "LISTING_HERO_REQUIRED",
        "An email-safe hero image is required before activation.",
        409
      );
    if (input.agentId && input.agentId !== before.agentId) {
      const agent = await tx.agent.findUnique({ where: { id: input.agentId } });
      if (!agent || !agent.isActive)
        throw new DomainError(
          "LISTING_AGENT_NOT_FOUND",
          "Choose an active Homix listing agent.",
          409
        );
    }
    const listing = await tx.listing.update({
      where: { id },
      data: { ...input, updatedByUserId: actor.userId },
    });
    if (input.agentId && input.agentId !== before.agentId) {
      await tx.campaign.updateMany({
        where: { listingId: id, status: "DRAFT" },
        data: {
          replyToAgentId: input.agentId,
          version: { increment: 1 },
          lastSuccessfulTestAt: null,
          lastTestedVersion: null,
        },
      });
    }
    await writeAudit(tx, actor, {
      action: "listing.update",
      entityType: "listing",
      entityId: id,
      before: { status: before.status, agentId: before.agentId },
      after: { status: listing.status, agentId: listing.agentId },
    });
    return listing;
  });
}
