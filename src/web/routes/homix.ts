import { getAiProvider } from "../../integrations/ai/index.js";
import { listingCosts } from "../../integrations/onekey/listingCosts.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { config } from "../../config/index.js";
import { normalizeEmail } from "../../shared/normalize.js";
import { DomainError } from "../../shared/errors.js";
import { actorFromRequest } from "../middleware/actor.js";
import {
  verifyPortalToken,
  campaignPortalIdentity,
  type PortalClaims,
  type PortalCampaignContext,
} from "../../modules/auth/portal.js";
import {
  quickStartCampaign,
  updateCampaign,
  previewCampaign,
  testSendCampaign,
  publishCampaign,
  transitionCampaign,
} from "../../modules/campaigns/service.js";
import {
  searchOneKeyListings,
  importOneKeyListing,
  configureCampaignOneKeyRecipients,
} from "../../modules/onekey/service.js";
import { getOneKeyProvider } from "../../integrations/onekey/index.js";
import { generateCampaignCopy, applyCampaignCopy } from "../../modules/ai/service.js";

export const homixRouter = Router();
const companySchema = z.record(
  z.string(),
  z.object({
    senderProfileId: z.uuid(),
    companyName: z.string().min(1),
    companyAddress: z.string().min(1),
    companyWebsite: z.url(),
  })
);
const versionSchema = z.number().int().positive();
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{16,80}$/);
const campaignInclude = { listing: true, senderProfile: true, savedAudience: true } as const;

homixRouter.use(async (req, res, next) => {
  try {
    const secret = process.env.HOMIX_PORTAL_INTEGRATION_SECRET?.trim();
    if (!secret || secret.length < 32)
      throw new DomainError("PORTAL_NOT_CONFIGURED", "Portal integration is unavailable.", 503);
    const token = req.get("authorization")?.replace(/^Bearer /, "") || "";
    const claims = verifyPortalToken(token, secret, {
      method: req.method,
      path: req.originalUrl,
      body: req.method === "GET" ? "" : JSON.stringify(req.body),
    });
    // Internal principal key, deliberately outside the native login email namespace.
    // Contact email remains in user.email and the signed campaign brand snapshot.
    const emailNormalized = `portal-agent:${claims.brand.agentId}`;
    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(891011, ${claims.brand.agentId}::integer)`;
      let existing = await tx.user.findUnique({ where: { portalAgentId: claims.brand.agentId } });
      if (existing && !existing.isActive)
        throw new DomainError("USER_DISABLED", "Your Email Service account is disabled.", 403);
      // Older manual mappings may point at a native administrator. Detach only
      // that mapping; preserve its login, role and historical foreign keys.
      if (existing && (existing.entraObjectId || existing.role === "ADMIN")) {
        await tx.user.update({ where: { id: existing.id }, data: { portalAgentId: null } });
        existing = null;
      }
      return existing
        ? tx.user.update({
            where: { id: existing.id },
            data: { email: claims.email, emailNormalized, displayName: claims.brand.name },
          })
        : tx.user.create({
            data: {
              portalAgentId: claims.brand.agentId,
              email: claims.email,
              emailNormalized,
              displayName: claims.brand.name,
              role: "MARKETER",
            },
          });
    });
    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: claims.admin ? "ADMIN" : "MARKETER",
    };
    res.locals.portal = claims;
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (error) {
    next(error);
  }
});
homixRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    keyGenerator: (req) => req.user!.id,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
const costlyLimit = rateLimit({
  windowMs: 3_600_000,
  limit: 20,
  keyGenerator: (req) => req.user!.id,
  standardHeaders: true,
  legacyHeaders: false,
});

function scope(claims: PortalClaims) {
  return {
    sourceApplication: "homixliving",
    ...(claims.admin ? {} : { portalOwnerAgentId: claims.brand.agentId }),
  };
}
async function owned(id: string, claims: PortalClaims) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: z.uuid().parse(id), ...scope(claims) },
    include: campaignInclude,
  });
  if (!campaign) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
  return campaign;
}
type CampaignRecord = Awaited<ReturnType<typeof owned>>;
function dto(c: CampaignRecord) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    version: c.version,
    subject: c.subject,
    preheader: c.preheader,
    introText: c.introText,
    ctaLabel: c.ctaLabel,
    ctaUrl: c.ctaUrl,
    lastTestedVersion: c.lastTestedVersion,
    lastSuccessfulTestAt: c.lastSuccessfulTestAt,
    scheduledAt: c.scheduledAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    audienceCount: c.savedAudience?.lastEstimatedCount ?? 0,
    marketingIdentity: campaignPortalIdentity(c),
    sender: {
      name: campaignPortalIdentity(c)?.companyName ?? c.senderProfile.fromName,
      email: c.senderProfile.fromEmail,
      dailyLimit: c.senderProfile.dailyLimit,
      nextBatchAt: c.senderProfile.nextBatchAt,
    },
    listing: c.listing
      ? {
          id: c.listing.id,
          sourceKey: c.listing.sourceKey,
          address: c.listing.addressLine1,
          status: c.listing.status,
        }
      : null,
    stats: {
      targetCount: c.targetCount,
      eligibleCount: c.eligibleCount,
      acceptedCount: c.acceptedCount,
      deliveredCount: c.deliveredCount,
      openedCount: c.openedCount,
      clickedCount: c.clickedCount,
      bouncedCount: c.bouncedCount,
      complainedCount: c.complainedCount,
      failedCount: c.failedCount,
      suppressedCount: c.suppressedCount,
    },
  };
}
function portalContext(
  claims: PortalClaims,
  portalRequestKey: string
): PortalCampaignContext & { portalRequestKey: string } {
  let companies: z.infer<typeof companySchema>;
  try {
    companies = companySchema.parse(JSON.parse(process.env.HOMIX_PORTAL_COMPANIES_JSON || "{}"));
  } catch {
    throw new DomainError(
      "PORTAL_COMPANY_CONFIG_INVALID",
      "Company sending configuration is invalid.",
      503
    );
  }
  const company = companies[claims.brand.companyId];
  if (!company)
    throw new DomainError(
      "PORTAL_COMPANY_NOT_CONFIGURED",
      "Your brokerage has no verified sending configuration.",
      409
    );
  return {
    sourceApplication: "homixliving",
    portalOwnerAgentId: claims.brand.agentId,
    portalRequestKey,
    senderProfileId: company.senderProfileId,
    marketingIdentity: {
      ...claims.brand,
      companyName: company.companyName,
      companyAddress: company.companyAddress,
      companyWebsite: company.companyWebsite,
    },
  };
}

homixRouter.get("/status", (_req, res) => {
  const claims = res.locals.portal as PortalClaims;
  const context = portalContext(claims, "status-check-only");
  res.json({
    ready: true,
    email: claims.email,
    brand: context.marketingIdentity,
    deliveryMode: config.deliveryMode,
    selfTestAllowed: config.testAllowlist.includes(normalizeEmail(claims.email)),
  });
});
homixRouter.get("/listings", async (req, res) => {
  const data = await searchOneKeyListings(z.string().min(2).max(200).parse(req.query.query));
  res.json({
    items: data.items.map((i) => ({
      sourceKey: i.sourceKey,
      listingId: i.listingId,
      unparsedAddress: i.unparsedAddress,
      city: i.city,
      stateCode: i.stateCode,
      postalCode: i.postalCode,
      listPrice: i.listPrice === null ? undefined : Number(i.listPrice),
      bedroomsTotal: i.bedroomsTotal,
      bathroomsTotalInteger: i.bathroomsTotalInteger,
      livingArea: i.livingArea === null ? undefined : Number(i.livingArea),
      ...listingCosts(i.sourceSnapshot),
      publicRemarks: i.publicRemarks,
      standardStatus: i.standardStatus,
      imageUrls: i.imageUrls,
    })),
    source: data.source,
  });
});
homixRouter.get("/listings/:sourceKey", async (req, res) => {
  const i = await getOneKeyProvider().getBySourceKey(
    z.string().min(1).max(200).parse(req.params.sourceKey)
  );
  res.json({
    listing: {
      sourceKey: i.sourceKey,
      listingId: i.listingId,
      unparsedAddress: i.unparsedAddress,
      city: i.city,
      stateCode: i.stateCode,
      postalCode: i.postalCode,
      listPrice: i.listPrice,
      bedroomsTotal: i.bedroomsTotal,
      bathroomsTotalInteger: i.bathroomsTotalInteger,
      livingArea: i.livingArea,
      ...listingCosts(i.raw),
      publicRemarks: i.publicRemarks,
      standardStatus: i.standardStatus,
      imageUrls: i.imageUrls,
    },
  });
});
homixRouter.post("/poster-highlights", costlyLimit, async (req, res) => {
  const value = z
    .object({
      address: z.string().trim().max(240),
      description: z.string().trim().min(10).max(12000),
      price: z.string().max(240).optional(),
      beds: z.string().max(240).optional(),
      baths: z.string().max(240).optional(),
      area: z.string().max(240).optional(),
      annualPropertyTax: z.string().max(240).optional(),
      monthlyMaintenanceFee: z.string().max(240).optional(),
      associationFee: z.string().max(240).optional(),
      associationFeeFrequency: z.string().max(240).optional(),
    })
    .parse(req.body.listing);
  const provider = getAiProvider();
  if (!provider.extractPosterHighlights)
    throw new DomainError(
      "AI_HIGHLIGHTS_UNAVAILABLE",
      "Highlight extraction is not configured.",
      503
    );
  const result = await provider.extractPosterHighlights(value);
  res.json({ ...result, model: provider.model });
});
homixRouter.get("/campaigns", async (req, res) => {
  const page = z.coerce.number().int().min(0).max(10000).default(0).parse(req.query.page);
  const campaigns = await prisma.campaign.findMany({
    where: scope(res.locals.portal),
    orderBy: { updatedAt: "desc" },
    take: 25,
    skip: page * 25,
    include: campaignInclude,
  });
  res.json({ campaigns: campaigns.map(dto), page, hasMore: campaigns.length === 25 });
});
homixRouter.get("/campaigns/:id", async (req, res) => {
  res.json({ campaign: dto(await owned(String(req.params.id), res.locals.portal)) });
});
homixRouter.get("/campaigns/:id/stats", async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal);
  const paused = await prisma.systemSetting.findUnique({ where: { key: "GLOBAL_SEND_PAUSED" } });
  res.json({ campaign: dto(c), globalPause: paused?.value ?? false });
});
homixRouter.post("/campaigns", async (req, res) => {
  const input = z
    .object({ sourceKey: z.string().min(1).max(200), clientRequestId: keySchema })
    .strict()
    .parse(req.body);
  const claims = res.locals.portal as PortalClaims,
    context = portalContext(claims, input.clientRequestId);
  const prior = await prisma.campaign.findFirst({
    where: {
      sourceApplication: "homixliving",
      portalOwnerAgentId: claims.brand.agentId,
      portalRequestKey: input.clientRequestId,
    },
    include: campaignInclude,
  });
  if (prior) {
    if (prior.listing?.sourceKey !== input.sourceKey)
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Request key was used for another listing.",
        409
      );
    res.json({ campaign: dto(prior) });
    return;
  }
  const imported = await importOneKeyListing(input.sourceKey, undefined, actorFromRequest(req));
  const result = await quickStartCampaign(imported.listing.id, actorFromRequest(req), context);
  res
    .status(result.created ? 201 : 200)
    .json({ campaign: dto(await owned(result.campaign.id, claims)) });
});
homixRouter.patch("/campaigns/:id", async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal);
  const { version, ...input } = z
    .object({
      version: versionSchema,
      name: z.string().min(1).max(200).optional(),
      subject: z.string().min(1).max(150),
      preheader: z.string().max(200),
      introText: z.string().max(10000),
      ctaLabel: z.string().min(1).max(80),
      ctaUrl: z
        .url()
        .refine((v) => new URL(v).protocol === "https:")
        .optional(),
    })
    .strict()
    .parse(req.body);
  const escaped = input.introText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
  await updateCampaign(
    c.id,
    { ...input, introHtml: `<p>${escaped}</p>` },
    version,
    actorFromRequest(req)
  );
  res.json({ campaign: dto(await owned(c.id, res.locals.portal)) });
});
homixRouter.post("/campaigns/:id/nearby", costlyLimit, async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal);
  const input = z
    .object({
      version: versionSchema,
      nearbyZipCount: z.number().int().min(0).max(10).default(3),
      closedMonths: z.number().int().min(1).max(36).default(12),
      limit: z.number().int().min(1).max(2000).default(2000),
      excludeEmailedWithinDays: z.number().int().min(1).max(365).default(14),
    })
    .strict()
    .parse(req.body);
  const result = await configureCampaignOneKeyRecipients(c.id, input, actorFromRequest(req));
  res.json({
    campaign: dto(await owned(c.id, res.locals.portal)),
    summary: result.summary,
    zipScope: result.selection.zipScope,
  });
});
homixRouter.post("/campaigns/:id/preview", async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal);
  res.json(await previewCampaign(c.id));
});
homixRouter.post("/campaigns/:id/test", costlyLimit, async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal),
    input = z
      .object({ version: versionSchema, clientRequestId: keySchema })
      .strict()
      .parse(req.body);
  await testSendCampaign(
    c.id,
    (res.locals.portal as PortalClaims).email,
    input.version,
    input.clientRequestId,
    actorFromRequest(req)
  );
  res.json({ campaign: dto(await owned(c.id, res.locals.portal)) });
});
homixRouter.post("/campaigns/:id/publish", async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal),
    input = z
      .object({
        version: versionSchema,
        clientRequestId: keySchema,
        scheduledAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(req.body);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined;
  if (scheduledAt && scheduledAt.getTime() <= Date.now())
    throw new DomainError("SCHEDULE_IN_PAST", "Choose a future send time.");
  await publishCampaign(
    c.id,
    actorFromRequest(req),
    input.version,
    scheduledAt,
    input.clientRequestId
  );
  res.status(202).json({ campaign: dto(await owned(c.id, res.locals.portal)) });
});
for (const action of ["pause", "resume", "cancel"] as const)
  homixRouter.post(`/campaigns/:id/${action}`, async (req, res) => {
    const c = await owned(String(req.params.id), res.locals.portal);
    await transitionCampaign(c.id, action, actorFromRequest(req));
    res.json({ campaign: dto(await owned(c.id, res.locals.portal)) });
  });
homixRouter.post("/campaigns/:id/ai", costlyLimit, async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal);
  const input = z
    .object({ tone: z.enum(["professional", "warm", "concise", "luxury"]).default("professional") })
    .strict()
    .parse(req.body);
  if (c.status !== "DRAFT")
    throw new DomainError("CAMPAIGN_LOCKED", "Only draft campaigns can be rewritten.", 409);
  res.json(await generateCampaignCopy(c.id, input.tone, actorFromRequest(req)));
});
homixRouter.post("/campaigns/:id/ai-apply", async (req, res) => {
  const c = await owned(String(req.params.id), res.locals.portal),
    input = z
      .object({
        version: versionSchema,
        generationId: z.uuid(),
        variantIndex: z.number().int().min(0).max(10),
        fields: z.array(z.enum(["subject", "preheader", "introText", "ctaLabel"])).min(1),
      })
      .strict()
      .parse(req.body);
  await applyCampaignCopy(
    c.id,
    input.generationId,
    input.variantIndex,
    input.fields,
    actorFromRequest(req),
    input.version
  );
  res.json({ campaign: dto(await owned(c.id, res.locals.portal)) });
});
