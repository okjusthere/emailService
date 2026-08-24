import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { getAiProvider, type AiTone } from "../../integrations/ai/index.js";
import { sanitizeIntro } from "../../email/compliance.js";
import { DomainError } from "../../shared/errors.js";
import type { ActorContext } from "../audit/service.js";
import { writeAudit } from "../audit/service.js";

function inputHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeHtmlText(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function facts(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function generateListingCopy(listingId: string, tone: AiTone, actor: ActorContext) {
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw new DomainError("LISTING_NOT_FOUND", "Listing not found.", 404);
  const provider = getAiProvider();
  const allowlisted = {
    ...facts(listing.facts),
    address: listing.addressLine1,
    city: listing.city,
    stateCode: listing.stateCode,
    postalCode: listing.postalCode,
    propertyType: listing.propertyType,
    askingPrice: listing.askingPrice?.toString(),
    buildingSqFt: listing.buildingSqFt,
    yearBuilt: listing.yearBuilt,
  };
  const proposal = await provider.generateListing({ tone, facts: allowlisted });
  const generation = await prisma.$transaction(async (tx) => {
    const created = await tx.aiGeneration.create({
      data: {
        kind: "LISTING_COPY",
        listingId,
        provider: provider.name,
        model: provider.model,
        tone,
        inputFactsHash: inputHash(allowlisted),
        proposal: JSON.parse(JSON.stringify(proposal)) as Prisma.InputJsonValue,
        createdByUserId: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: "ai.listing_generated",
      entityType: "listing",
      entityId: listingId,
      after: { generationId: created.id, provider: provider.name, model: provider.model, tone },
    });
    return created;
  });
  return { generationId: generation.id, proposal };
}

export async function applyListingCopy(
  listingId: string,
  generationId: string,
  fieldsToApply: string[],
  actor: ActorContext
) {
  const allowed = new Set(["title", "shortDescription", "longDescription", "highlights"]);
  if (!fieldsToApply.length || fieldsToApply.some((field) => !allowed.has(field)))
    throw new DomainError("AI_FIELDS_INVALID", "Choose one or more supported proposal fields.");
  return prisma.$transaction(async (tx) => {
    const generation = await tx.aiGeneration.findUnique({ where: { id: generationId } });
    if (!generation || generation.listingId !== listingId || generation.kind !== "LISTING_COPY")
      throw new DomainError("AI_GENERATION_NOT_FOUND", "Listing proposal not found.", 404);
    const proposal = generation.proposal as Record<string, unknown>;
    const data = Object.fromEntries(fieldsToApply.map((field) => [field, proposal[field]]));
    const listing = await tx.listing.update({
      where: { id: listingId },
      data: { ...data, updatedByUserId: actor.userId },
    });
    await tx.aiGeneration.update({
      where: { id: generation.id },
      data: { status: "APPLIED", appliedFields: fieldsToApply, appliedAt: new Date() },
    });
    await writeAudit(tx, actor, {
      action: "ai.listing_applied",
      entityType: "listing",
      entityId: listingId,
      after: { generationId, fields: fieldsToApply },
    });
    return listing;
  });
}

export async function generateCampaignCopy(campaignId: string, tone: AiTone, actor: ActorContext) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { listing: true },
  });
  if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
  const provider = getAiProvider();
  const allowlisted = campaign.listing
    ? {
        ...facts(campaign.listing.facts),
        address: campaign.listing.addressLine1,
        city: campaign.listing.city,
      }
    : {};
  const current = {
    subject: campaign.subject,
    preheader: campaign.preheader,
    introText: campaign.introText,
    ctaLabel: campaign.ctaLabel,
  };
  const proposal = await provider.generateCampaign({ tone, facts: allowlisted, current });
  const generation = await prisma.$transaction(async (tx) => {
    const created = await tx.aiGeneration.create({
      data: {
        kind: "CAMPAIGN_COPY",
        campaignId,
        provider: provider.name,
        model: provider.model,
        tone,
        inputFactsHash: inputHash({ allowlisted, current }),
        proposal: JSON.parse(JSON.stringify(proposal)) as Prisma.InputJsonValue,
        createdByUserId: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: "ai.campaign_generated",
      entityType: "campaign",
      entityId: campaignId,
      after: { generationId: created.id, provider: provider.name, model: provider.model, tone },
    });
    return created;
  });
  return { generationId: generation.id, proposal };
}

export async function applyCampaignCopy(
  campaignId: string,
  generationId: string,
  variantIndex: number,
  fieldsToApply: string[],
  actor: ActorContext,
  expectedVersion?: number
) {
  const allowed = new Set(["subject", "preheader", "introText", "ctaLabel"]);
  if (!fieldsToApply.length || fieldsToApply.some((field) => !allowed.has(field)))
    throw new DomainError("AI_FIELDS_INVALID", "Choose one or more supported proposal fields.");
  return prisma.$transaction(async (tx) => {
    const current = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!current) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
    if (current.status !== "DRAFT")
      throw new DomainError("CAMPAIGN_LOCKED", "Only a draft email can be rewritten.", 409);
    if (expectedVersion !== undefined && current.version !== expectedVersion)
      throw new DomainError(
        "CAMPAIGN_VERSION_CONFLICT",
        "This email changed while AI was writing.",
        409,
        { currentVersion: current.version }
      );
    const generation = await tx.aiGeneration.findUnique({ where: { id: generationId } });
    if (!generation || generation.campaignId !== campaignId || generation.kind !== "CAMPAIGN_COPY")
      throw new DomainError("AI_GENERATION_NOT_FOUND", "Campaign proposal not found.", 404);
    const proposal = generation.proposal as { variants?: Array<Record<string, unknown>> };
    const variant = proposal.variants?.[variantIndex];
    if (!variant)
      throw new DomainError("AI_VARIANT_INVALID", "Campaign proposal variant not found.");
    const data: Record<string, unknown> = Object.fromEntries(
      fieldsToApply.map((field) => [field, variant[field]])
    );
    if (fieldsToApply.includes("introText"))
      data.introHtml = sanitizeIntro(`<p>${escapeHtmlText(variant.introText)}</p>`);
    const updated = await tx.campaign.updateMany({
      where: { id: campaignId, version: expectedVersion ?? current.version, status: "DRAFT" },
      data: {
        ...data,
        version: { increment: 1 },
        updatedByUserId: actor.userId,
        lastSuccessfulTestAt: null,
        lastTestedVersion: null,
      },
    });
    if (updated.count !== 1)
      throw new DomainError(
        "CAMPAIGN_VERSION_CONFLICT",
        "This email changed while AI was writing.",
        409
      );
    const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    await tx.aiGeneration.update({
      where: { id: generation.id },
      data: { status: "APPLIED", appliedFields: fieldsToApply, appliedAt: new Date() },
    });
    await writeAudit(tx, actor, {
      action: "ai.campaign_applied",
      entityType: "campaign",
      entityId: campaignId,
      after: { generationId, variantIndex, fields: fieldsToApply },
    });
    return campaign;
  });
}
