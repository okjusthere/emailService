import { Prisma, UserRole } from "@prisma/client";
import { Router, type Response } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../../config/index.js";
import { checkDatabase, prisma } from "../../db/prisma.js";
import { inTransaction } from "../../db/transactions.js";
import { sanitizeIntro } from "../../email/compliance.js";
import { createLocalSession } from "../../modules/auth/session.js";
import { resolveLocalUser } from "../../modules/auth/service.js";
import { dashboardSummary, recomputeCampaignStats } from "../../modules/analytics/service.js";
import { estimateAudience } from "../../modules/audiences/service.js";
import { processAndStoreAsset } from "../../modules/assets/service.js";
import { writeAudit } from "../../modules/audit/service.js";
import { campaignInputSchema, testSendSchema } from "../../modules/campaigns/schemas.js";
import {
  createCampaign,
  listCampaigns,
  markCampaignReady,
  previewCampaign,
  queueCampaignSnapshot,
  testSendCampaign,
  transitionCampaign,
  updateCampaign,
} from "../../modules/campaigns/service.js";
import {
  archiveContact,
  countContactsForExport,
  createContact,
  iterateContactsForExport,
  listContacts,
  restoreContact,
  updateContact,
} from "../../modules/contacts/service.js";
import { createListing, listListings, updateListing } from "../../modules/listings/service.js";
import {
  confirmedImportMapping,
  previewContactImport,
  validateContactImport,
} from "../../modules/imports/service.js";
import { upsertSuppression } from "../../modules/suppressions/domain.js";
import { DomainError } from "../../shared/errors.js";
import { escapeCsvCell, normalizeEmail, normalizeName } from "../../shared/normalize.js";
import {
  audienceFilterSchema,
  campaignActionSchema,
  paginationSchema,
} from "../../shared/schemas.js";
import { createAssetStorage } from "../../storage/index.js";
import { getPrivateObjectStorage } from "../../storage/PrivateObjectStorage.js";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { actorFromRequest } from "../middleware/actor.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
const uploadLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? "unauthenticated",
  standardHeaders: true,
  legacyHeaders: false,
});
const assetStorage = createAssetStorage();
const idParam = z.object({ id: z.uuid() });
const recipientFilterSchema = z.object({
  sendState: z
    .enum([
      "PENDING",
      "RESERVED",
      "SENDING",
      "ACCEPTED",
      "TEMPORARY_FAILED",
      "PERMANENT_FAILED",
      "SUPPRESSED",
      "CANCELLED",
      "MANUAL_REVIEW",
    ])
    .optional(),
  deliveryState: z
    .enum(["UNKNOWN", "DELIVERED", "BOUNCED", "COMPLAINED", "PROVIDER_SUPPRESSED"])
    .optional(),
});

async function writeResponseChunk(res: Response, chunk: string): Promise<boolean> {
  if (res.destroyed) return false;
  if (res.write(chunk)) return true;
  await Promise.race([once(res, "drain"), once(res, "close")]);
  return !res.destroyed;
}

router.get("/auth/me", (req, res) => {
  res.json({ user: req.user });
});
router.post("/auth/logout", (_req, res) => {
  res.clearCookie("homix_session", {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
  });
  res.json({
    success: true,
    easyAuthLogoutUrl: config.authMode === "azure-easyauth" ? "/.auth/logout" : null,
  });
});

router.get("/users", requireRole("ADMIN"), async (_req, res) => {
  res.json({ items: await prisma.user.findMany({ orderBy: { createdAt: "desc" } }) });
});
router.post("/users", requireRole("ADMIN"), async (req, res) => {
  const input = z
    .object({
      email: z.email(),
      displayName: z.string().max(200).optional(),
      role: z.enum(UserRole).default("VIEWER"),
    })
    .parse(req.body);
  const emailNormalized = normalizeEmail(input.email);
  const user = await inTransaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email.trim(),
        emailNormalized,
        displayName: input.displayName,
        role: input.role,
      },
    });
    await writeAudit(tx, actorFromRequest(req), {
      action: "user.provision",
      entityType: "user",
      entityId: created.id,
      after: { emailNormalized, role: created.role },
    });
    return created;
  });
  res.status(201).json(user);
});
router.patch("/users/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = z
    .object({ role: z.enum(UserRole).optional(), isActive: z.boolean().optional() })
    .parse(req.body);
  const user = await inTransaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id } });
    const updated = await tx.user.update({ where: { id }, data: input });
    await writeAudit(tx, actorFromRequest(req), {
      action: "user.update",
      entityType: "user",
      entityId: id,
      before: { role: before.role, isActive: before.isActive },
      after: { role: updated.role, isActive: updated.isActive },
    });
    return updated;
  });
  res.json(user);
});

const agentSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  email: z.email(),
  phone: z.string().max(50).nullable().optional(),
  title: z.string().max(100).nullable().optional(),
  licenseNumber: z.string().max(100).nullable().optional(),
  headshotUrl: z.url().nullable().optional(),
  signatureHtml: z.string().max(5000).nullable().optional(),
  userId: z.uuid().nullable().optional(),
});
router.get("/agents", async (_req, res) => {
  res.json({ items: await prisma.agent.findMany({ orderBy: { displayName: "asc" } }) });
});
router.post("/agents", requireRole("ADMIN"), async (req, res) => {
  const input = agentSchema.parse(req.body);
  const agent = await inTransaction(async (tx) => {
    const created = await tx.agent.create({
      data: {
        ...input,
        emailNormalized: normalizeEmail(input.email),
        signatureHtml:
          input.signatureHtml == null ? input.signatureHtml : sanitizeIntro(input.signatureHtml),
      },
    });
    await writeAudit(tx, actorFromRequest(req), {
      action: "agent.create",
      entityType: "agent",
      entityId: created.id,
    });
    return created;
  });
  res.status(201).json(agent);
});
router.get("/agents/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.agent.findUnique({ where: { id } });
  if (!item) throw new DomainError("AGENT_NOT_FOUND", "Agent not found.", 404);
  res.json(item);
});
router.patch("/agents/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = agentSchema.partial().parse(req.body);
  const item = await inTransaction(async (tx) => {
    const updated = await tx.agent.update({
      where: { id },
      data: {
        ...input,
        ...(input.email ? { emailNormalized: normalizeEmail(input.email) } : {}),
        ...(input.signatureHtml === undefined
          ? {}
          : {
              signatureHtml:
                input.signatureHtml === null ? null : sanitizeIntro(input.signatureHtml),
            }),
      },
    });
    await writeAudit(tx, actorFromRequest(req), {
      action: "agent.update",
      entityType: "agent",
      entityId: id,
    });
    return updated;
  });
  res.json(item);
});
router.delete("/agents/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await inTransaction(async (tx) => {
    const updated = await tx.agent.update({ where: { id }, data: { isActive: false } });
    await writeAudit(tx, actorFromRequest(req), {
      action: "agent.deactivate",
      entityType: "agent",
      entityId: id,
    });
    return updated;
  });
  res.json(item);
});

router.get("/contacts", async (req, res) => {
  res.json(await listContacts(req.query));
});
router.post("/contacts", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  res.status(201).json(await createContact(req.body, actorFromRequest(req)));
});
router.get("/contacts/export", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const header = [
    "email",
    "name",
    "company",
    "contact_type",
    "permission_basis",
    "suppressed",
    "suppression_reason",
  ];
  const rowCount = await countContactsForExport(req.query);
  await prisma.auditLog.create({
    data: {
      actorUserId: req.user?.id,
      action: "contacts.export",
      entityType: "contact",
      requestId: String(req.id ?? "unknown"),
      after: { rowCount },
    },
  });
  res.type("text/csv").attachment("homix-contacts.csv");
  if (!(await writeResponseChunk(res, `${header.join(",")}\n`))) return;
  for await (const contact of iterateContactsForExport(req.query)) {
    const row = [
      contact.email,
      contact.displayName,
      contact.company,
      contact.contactType,
      contact.permissionBasis,
      contact.suppressed,
      contact.suppressionReason,
    ]
      .map(escapeCsvCell)
      .join(",");
    if (!(await writeResponseChunk(res, `${row}\n`))) return;
  }
  res.end();
});
router.post("/contacts/bulk-update", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const input = z
    .object({
      ids: z.array(z.uuid()).min(1).max(1000),
      status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
      relationshipMode: z.enum(["add", "remove", "replace"]).default("add"),
      tagIds: z.array(z.uuid()).max(100).optional(),
      marketIds: z.array(z.uuid()).max(100).optional(),
      propertyInterestIds: z.array(z.uuid()).max(100).optional(),
    })
    .refine(
      (value) =>
        Boolean(
          value.status ||
          value.tagIds?.length ||
          value.marketIds?.length ||
          value.propertyInterestIds?.length
        ),
      "Choose a status or relationship update"
    )
    .parse(req.body);
  const result = await inTransaction(async (tx) => {
    const updated = input.status
      ? await tx.contact.updateMany({
          where: { id: { in: input.ids } },
          data: {
            status: input.status,
            archivedAt: input.status === "ARCHIVED" ? new Date() : null,
          },
        })
      : { count: input.ids.length };
    const relationships = [
      {
        ids: input.tagIds,
        deleteMany: (ids: string[]) =>
          tx.contactTag.deleteMany({
            where: { contactId: { in: input.ids }, ...(ids.length ? { tagId: { in: ids } } : {}) },
          }),
        createMany: (ids: string[]) =>
          tx.contactTag.createMany({
            data: input.ids.flatMap((contactId) => ids.map((tagId) => ({ contactId, tagId }))),
            skipDuplicates: true,
          }),
      },
      {
        ids: input.marketIds,
        deleteMany: (ids: string[]) =>
          tx.contactMarket.deleteMany({
            where: {
              contactId: { in: input.ids },
              ...(ids.length ? { marketId: { in: ids } } : {}),
            },
          }),
        createMany: (ids: string[]) =>
          tx.contactMarket.createMany({
            data: input.ids.flatMap((contactId) =>
              ids.map((marketId) => ({ contactId, marketId }))
            ),
            skipDuplicates: true,
          }),
      },
      {
        ids: input.propertyInterestIds,
        deleteMany: (ids: string[]) =>
          tx.contactPropertyInterest.deleteMany({
            where: {
              contactId: { in: input.ids },
              ...(ids.length ? { propertyInterestId: { in: ids } } : {}),
            },
          }),
        createMany: (ids: string[]) =>
          tx.contactPropertyInterest.createMany({
            data: input.ids.flatMap((contactId) =>
              ids.map((propertyInterestId) => ({ contactId, propertyInterestId }))
            ),
            skipDuplicates: true,
          }),
      },
    ];
    for (const relationship of relationships) {
      if (!relationship.ids) continue;
      if (input.relationshipMode === "replace") await relationship.deleteMany([]);
      else if (input.relationshipMode === "remove") {
        await relationship.deleteMany(relationship.ids);
        continue;
      }
      if (relationship.ids.length) await relationship.createMany(relationship.ids);
    }
    await writeAudit(tx, actorFromRequest(req), {
      action: "contacts.bulk_update",
      entityType: "contact",
      after: {
        count: updated.count,
        status: input.status,
        relationshipMode: input.relationshipMode,
        tagCount: input.tagIds?.length ?? 0,
        marketCount: input.marketIds?.length ?? 0,
        propertyInterestCount: input.propertyInterestIds?.length ?? 0,
      },
    });
    return updated;
  });
  res.json(result);
});
router.get("/contacts/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.contact.findUnique({
    where: { id },
    include: {
      tags: { include: { tag: true } },
      markets: { include: { market: true } },
      propertyInterests: { include: { propertyInterest: true } },
      campaignRecipients: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { campaign: { select: { name: true, status: true } } },
      },
    },
  });
  if (!item) throw new DomainError("CONTACT_NOT_FOUND", "Contact not found.", 404);
  const suppression = await prisma.suppression.findUnique({
    where: { emailNormalized: item.emailNormalized },
  });
  res.json({ ...item, suppression });
});
router.patch("/contacts/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await updateContact(id, req.body, actorFromRequest(req)));
});
router.delete("/contacts/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await archiveContact(id, actorFromRequest(req)));
});
router.post("/contacts/:id/restore", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await restoreContact(id, actorFromRequest(req)));
});

router.post(
  "/contact-imports/upload",
  requireRole("ADMIN", "MARKETER"),
  uploadLimit,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw new DomainError("FILE_REQUIRED", "CSV file is required.");
    if (req.file.size > 20 * 1024 * 1024)
      throw new DomainError("IMPORT_TOO_LARGE", "CSV exceeds 20 MB.", 413);
    if (!/^(text\/csv|application\/vnd\.ms-excel|text\/plain)$/.test(req.file.mimetype))
      throw new DomainError("IMPORT_TYPE_INVALID", "Import must be a CSV file.", 415);
    const metadata = z
      .object({
        sourceType: z.enum([
          "PAST_CLIENT",
          "OPEN_HOUSE",
          "WEBSITE",
          "BROKER_RELATIONSHIP",
          "EVENT",
          "CRM_IMPORT",
          "MANUAL",
          "REFERRAL",
          "LEGACY_EMAIL_SERVICE",
          "OTHER",
        ]),
        permissionBasis: z.enum(["OPT_IN", "EXISTING_RELATIONSHIP", "BUSINESS_CONTACT", "UNKNOWN"]),
        sourceDetail: z.string().max(500).optional(),
      })
      .parse(req.body);
    const blobName = `contact-imports/${randomUUID()}.csv`;
    await getPrivateObjectStorage().put(blobName, req.file.buffer, "text/csv");
    const item = await prisma.contactImport.create({
      data: {
        fileName: req.file.originalname.slice(0, 250),
        blobName,
        sourceMetadata: metadata,
        createdByUserId: req.user!.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: req.user?.id,
        action: "contact_import.upload",
        entityType: "contact_import",
        entityId: item.id,
        requestId: String(req.id ?? "unknown"),
        after: {
          fileSize: req.file.size,
          sourceType: metadata.sourceType,
          permissionBasis: metadata.permissionBasis,
        },
      },
    });
    res.status(201).json({ ...item, inspection: await previewContactImport(item.id) });
  }
);
router.post("/contact-imports/:id/validate", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = z
    .object({ mapping: z.record(z.string(), z.string()).optional() })
    .parse(req.body ?? {});
  res.json(await validateContactImport(id, input.mapping));
});
router.post("/contact-imports/:id/apply", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.contactImport.findUniqueOrThrow({ where: { id } });
  if (item.status !== "READY" && item.status !== "FAILED")
    throw new DomainError("IMPORT_INVALID_STATE", "Import must be validated before apply.", 409);
  const input = z
    .object({ confirmCreateUnknownReferences: z.boolean().default(false) })
    .parse(req.body ?? {});
  let mapping: ReturnType<typeof confirmedImportMapping>;
  try {
    mapping = confirmedImportMapping(item.mapping, input.confirmCreateUnknownReferences);
  } catch (error) {
    throw new DomainError(
      "IMPORT_MAPPING_CONFIRMATION_REQUIRED",
      error instanceof Error ? error.message : "Confirm the saved import mapping before apply.",
      409
    );
  }
  await prisma.$transaction([
    prisma.contactImport.update({
      where: { id },
      data: { status: "PROCESSING", mapping },
    }),
    prisma.job.upsert({
      where: { uniqueKey: `IMPORT_CONTACTS/${id}` },
      create: {
        type: "IMPORT_CONTACTS",
        uniqueKey: `IMPORT_CONTACTS/${id}`,
        payload: { importId: id },
      },
      update: {
        status: "PENDING",
        runAt: new Date(),
        attempts: 0,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
      },
    }),
  ]);
  res.status(202).json({ id, status: "PROCESSING" });
});
router.get("/contact-imports/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.contactImport.findUnique({ where: { id } });
  if (!item) throw new DomainError("IMPORT_NOT_FOUND", "Import not found.", 404);
  res.json(item);
});
router.get(
  "/contact-imports/:id/errors.csv",
  requireRole("ADMIN", "MARKETER"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    const item = await prisma.contactImport.findUniqueOrThrow({ where: { id } });
    if (!item.errorReportUrl)
      throw new DomainError("IMPORT_REPORT_NOT_READY", "Import error report is not ready.", 404);
    res
      .type("text/csv")
      .attachment(`import-${id}-errors.csv`)
      .send(await getPrivateObjectStorage().get(item.errorReportUrl));
  }
);

const refSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  type: z.enum(["REGION", "STATE", "COUNTY", "CITY", "NEIGHBORHOOD", "CUSTOM"]).optional(),
  parentId: z.uuid().nullable().optional(),
  stateCode: z.string().length(2).nullable().optional(),
  propertyType: z
    .enum([
      "OFFICE",
      "RETAIL",
      "INDUSTRIAL",
      "MULTIFAMILY",
      "LAND",
      "MIXED_USE",
      "HOSPITALITY",
      "SPECIAL_PURPOSE",
      "BUSINESS",
      "RESIDENTIAL",
      "OTHER",
    ])
    .nullable()
    .optional(),
});
router.get("/tags", async (_req, res) => {
  res.json({
    items: await prisma.tag.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  });
});
router.post("/tags", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const input = refSchema.parse(req.body);
  const item = await prisma.tag.create({
    data: { name: input.name, normalizedName: normalizeName(input.name), color: input.color },
  });
  res.status(201).json(item);
});
router.patch("/tags/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = refSchema.partial().parse(req.body);
  res.json(
    await prisma.tag.update({
      where: { id },
      data: {
        name: input.name,
        normalizedName: input.name ? normalizeName(input.name) : undefined,
        color: input.color,
      },
    })
  );
});
router.delete("/tags/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await prisma.tag.update({ where: { id }, data: { isActive: false } }));
});
router.get("/markets", async (_req, res) => {
  res.json({
    items: await prisma.market.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  });
});
router.post("/markets", requireRole("ADMIN"), async (req, res) => {
  const input = refSchema.parse(req.body);
  const item = await prisma.market.create({
    data: {
      name: input.name,
      slug: normalizeName(input.name).replace(/[^a-z0-9]+/g, "-"),
      type: input.type ?? "CUSTOM",
      parentId: input.parentId,
      stateCode: input.stateCode,
    },
  });
  res.status(201).json(item);
});
router.patch("/markets/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = refSchema.partial().parse(req.body);
  res.json(
    await prisma.market.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type,
        parentId: input.parentId,
        stateCode: input.stateCode,
      },
    })
  );
});
router.delete("/markets/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await prisma.market.update({ where: { id }, data: { isActive: false } }));
});
router.get("/property-interests", async (_req, res) => {
  res.json({
    items: await prisma.propertyInterest.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
  });
});
router.post("/property-interests", requireRole("ADMIN"), async (req, res) => {
  const input = refSchema.parse(req.body);
  const item = await prisma.propertyInterest.create({
    data: {
      name: input.name,
      slug: normalizeName(input.name).replace(/[^a-z0-9]+/g, "-"),
      propertyType: input.propertyType,
    },
  });
  res.status(201).json(item);
});
router.patch("/property-interests/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = refSchema.partial().parse(req.body);
  res.json(
    await prisma.propertyInterest.update({
      where: { id },
      data: { name: input.name, propertyType: input.propertyType },
    })
  );
});
router.delete("/property-interests/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await prisma.propertyInterest.update({ where: { id }, data: { isActive: false } }));
});

router.get("/suppressions", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const page = paginationSchema.parse(req.query);
  const [items, total] = await prisma.$transaction([
    prisma.suppression.findMany({
      skip: (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: { suppressedAt: "desc" },
    }),
    prisma.suppression.count(),
  ]);
  res.json({ items, total, page: page.page, limit: page.limit });
});
router.post("/suppressions/manual", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const input = z
    .object({ email: z.email(), details: z.string().min(3).max(1000) })
    .parse(req.body);
  const item = await inTransaction(async (tx) => {
    const suppression = await upsertSuppression(tx, {
      email: input.email,
      reason: "MANUAL",
      source: "ADMIN",
      details: { reason: input.details },
    });
    await writeAudit(tx, actorFromRequest(req), {
      action: "suppression.manual",
      entityType: "suppression",
      entityId: suppression.id,
    });
    return suppression;
  });
  res.status(201).json(item);
});
router.post("/suppressions/:id/release", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = z.object({ reason: z.string().trim().min(10).max(1000) }).parse(req.body);
  const item = await inTransaction(async (tx) => {
    const before = await tx.suppression.findUniqueOrThrow({ where: { id } });
    const updated = await tx.suppression.update({
      where: { id },
      data: {
        isActive: false,
        releasedAt: new Date(),
        releasedByUserId: req.user?.id,
        releaseReason: input.reason,
      },
    });
    await writeAudit(tx, actorFromRequest(req), {
      action: "suppression.release",
      entityType: "suppression",
      entityId: id,
      before: { reason: before.reason, active: before.isActive },
      after: { active: false, releaseReason: input.reason },
    });
    return updated;
  });
  res.json(item);
});

router.get("/listings", async (req, res) => {
  res.json(await listListings(req.query));
});
router.post("/listings", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  res.status(201).json(await createListing(req.body, actorFromRequest(req)));
});
router.get("/listings/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.listing.findUnique({
    where: { id },
    include: {
      agent: true,
      assets: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      campaigns: { select: { id: true, name: true, status: true } },
    },
  });
  if (!item) throw new DomainError("LISTING_NOT_FOUND", "Listing not found.", 404);
  res.json(item);
});
router.patch("/listings/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await updateListing(id, req.body, actorFromRequest(req)));
});
router.post("/listings/:id/archive", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(
    await prisma.listing.update({
      where: { id },
      data: { status: "ARCHIVED", updatedByUserId: req.user?.id },
    })
  );
});
router.post("/listings/:id/duplicate", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const source = await prisma.listing.findUniqueOrThrow({ where: { id } });
  const {
    id: _id,
    slug,
    createdAt: _created,
    updatedAt: _updated,
    publishedAt: _published,
    facts,
    ...copy
  } = source;
  const duplicate = await prisma.listing.create({
    data: {
      ...copy,
      facts: facts === null ? Prisma.JsonNull : (facts as Prisma.InputJsonValue),
      slug: `${slug}-copy-${Date.now()}`,
      internalName: `${copy.internalName} (Copy)`,
      title: `${copy.title} (Copy)`,
      status: "DRAFT",
      createdByUserId: req.user!.id,
      updatedByUserId: req.user!.id,
    },
  });
  res.status(201).json(duplicate);
});
router.post(
  "/listings/:id/assets",
  requireRole("ADMIN", "MARKETER"),
  uploadLimit,
  upload.single("file"),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    if (!req.file) throw new DomainError("FILE_REQUIRED", "Asset file is required.");
    const kind = z
      .enum(["HERO", "GALLERY", "FLOORPLAN", "BROCHURE", "LOGO", "OTHER"])
      .parse(req.body.kind ?? "GALLERY");
    const stored = await processAndStoreAsset(assetStorage, {
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      declaredMime: req.file.mimetype,
    });
    const item = await prisma.listingAsset.create({
      data: {
        listingId: id,
        kind,
        blobName: stored.blobName,
        publicUrl: stored.publicUrl,
        thumbnailUrl: stored.thumbnailUrl,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        width: stored.width,
        height: stored.height,
        altText: String(req.body.altText ?? "").slice(0, 250) || null,
        isEmailSafe: stored.isEmailSafe,
        originalFileName: req.file.originalname.slice(0, 250),
      },
    });
    res.status(201).json(item);
  }
);
router.patch("/listings/:id/assets/reorder", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = z
    .object({
      assets: z
        .array(
          z.object({
            id: z.uuid(),
            sortOrder: z.number().int().min(0),
            kind: z.enum(["HERO", "GALLERY", "FLOORPLAN", "BROCHURE", "LOGO", "OTHER"]).optional(),
          })
        )
        .max(100),
    })
    .parse(req.body);
  await prisma.$transaction(
    input.assets.map((asset) =>
      prisma.listingAsset.update({
        where: { id: asset.id, listingId: id },
        data: { sortOrder: asset.sortOrder, kind: asset.kind },
      })
    )
  );
  res.json({ success: true });
});
router.delete(
  "/listings/:id/assets/:assetId",
  requireRole("ADMIN", "MARKETER"),
  async (req, res) => {
    const input = z.object({ id: z.uuid(), assetId: z.uuid() }).parse(req.params);
    const asset = await prisma.listingAsset.update({
      where: { id: input.assetId, listingId: input.id },
      data: { deletedAt: new Date() },
    });
    res.json(asset);
  }
);

router.post("/audiences/estimate", requireRole("ADMIN", "MARKETER", "VIEWER"), async (req, res) => {
  res.json(await estimateAudience(req.body, req.user?.role !== "VIEWER"));
});
router.get("/audiences", async (_req, res) => {
  res.json({ items: await prisma.savedAudience.findMany({ orderBy: { updatedAt: "desc" } }) });
});
router.post("/audiences", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const input = z
    .object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).nullable().optional(),
      filter: audienceFilterSchema,
    })
    .parse(req.body);
  const item = await prisma.savedAudience.create({
    data: { ...input, createdByUserId: req.user!.id, updatedByUserId: req.user!.id },
  });
  res.status(201).json(item);
});
router.get("/audiences/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.savedAudience.findUnique({ where: { id } });
  if (!item) throw new DomainError("AUDIENCE_NOT_FOUND", "Audience not found.", 404);
  res.json(item);
});
router.patch("/audiences/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = z
    .object({
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      filter: audienceFilterSchema.optional(),
    })
    .parse(req.body);
  res.json(
    await prisma.savedAudience.update({
      where: { id },
      data: { ...input, updatedByUserId: req.user!.id },
    })
  );
});
router.post("/audiences/:id/duplicate", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const source = await prisma.savedAudience.findUniqueOrThrow({ where: { id } });
  res.status(201).json(
    await prisma.savedAudience.create({
      data: {
        name: `${source.name} (Copy)`,
        description: source.description,
        filter: source.filter as Prisma.InputJsonValue,
        createdByUserId: req.user!.id,
        updatedByUserId: req.user!.id,
      },
    })
  );
});
router.delete("/audiences/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  await prisma.savedAudience.delete({ where: { id } });
  res.status(204).end();
});

const senderSchema = z.object({
  name: z.string().min(1),
  fromName: z.string().min(1),
  fromEmail: z.email(),
  domain: z.string().min(3),
  fixedReplyToEmail: z.email().nullable().optional(),
  dailyLimit: z.number().int().positive(),
  batchSize: z.number().int().min(1).max(100),
  minBatchIntervalSeconds: z.number().int().min(1),
  timezone: z.string(),
  sendWindowStart: z.string().regex(/^\d{2}:\d{2}$/),
  sendWindowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).min(1),
  warmupEnabled: z.boolean().optional(),
  warmupSchedule: z
    .array(z.object({ day: z.number().int().positive(), limit: z.number().int().positive() }))
    .optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});
router.get("/sender-profiles", async (_req, res) => {
  res.json({ items: await prisma.senderProfile.findMany({ orderBy: { name: "asc" } }) });
});
router.post("/sender-profiles", requireRole("ADMIN"), async (req, res) => {
  const input = senderSchema.parse(req.body);
  const item = await inTransaction(async (tx) => {
    if (input.isDefault) await tx.senderProfile.updateMany({ data: { isDefault: false } });
    return tx.senderProfile.create({
      data: {
        ...input,
        fromEmailNormalized: normalizeEmail(input.fromEmail),
        warmupSchedule: input.warmupSchedule,
      },
    });
  });
  res.status(201).json(item);
});
router.patch("/sender-profiles/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = senderSchema.partial().parse(req.body);
  const item = await inTransaction(async (tx) => {
    if (input.isDefault)
      await tx.senderProfile.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    return tx.senderProfile.update({
      where: { id },
      data: {
        ...input,
        ...(input.fromEmail ? { fromEmailNormalized: normalizeEmail(input.fromEmail) } : {}),
      },
    });
  });
  res.json(item);
});
router.post("/sender-profiles/:id/verify", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = z.object({ confirmation: z.literal("RESEND_DOMAIN_VERIFIED") }).parse(req.body);
  void input;
  const sender = await inTransaction(async (tx) => {
    const updated = await tx.senderProfile.update({
      where: { id },
      data: { verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });
    const alert = await tx.systemSetting.findUnique({ where: { key: "DELIVERABILITY_ALERT" } });
    if (
      alert?.value &&
      typeof alert.value === "object" &&
      !Array.isArray(alert.value) &&
      "senderProfileId" in alert.value &&
      alert.value.senderProfileId === id
    )
      await tx.systemSetting.update({
        where: { key: "DELIVERABILITY_ALERT" },
        data: {
          value: {
            ...alert.value,
            actionRequired: false,
            acknowledgedAt: new Date().toISOString(),
          },
        },
      });
    return updated;
  });
  res.json(sender);
});
router.post("/sender-profiles/:id/suspend", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(
    await prisma.senderProfile.update({ where: { id }, data: { verificationStatus: "SUSPENDED" } })
  );
});
router.get("/sender-profiles/:id/quota", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const sender = await prisma.senderProfile.findUniqueOrThrow({ where: { id } });
  const usage = await prisma.senderDailyUsage.findMany({
    where: { senderProfileId: id },
    orderBy: { localDate: "desc" },
    take: 7,
  });
  res.json({ dailyLimit: sender.dailyLimit, usage });
});

router.get("/campaigns", async (req, res) => {
  res.json(await listCampaigns(req.query));
});
router.post("/campaigns", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  campaignInputSchema.parse(req.body);
  res.status(201).json(await createCampaign(req.body, actorFromRequest(req)));
});
router.get("/campaigns/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.campaign.findUnique({
    where: { id },
    include: { listing: true, senderProfile: true, replyToAgent: true, savedAudience: true },
  });
  if (!item) throw new DomainError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
  res.json(item);
});
router.patch("/campaigns/:id", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const version = z.coerce
    .number()
    .int()
    .positive()
    .parse(req.get("if-match") ?? req.body.version);
  res.json(await updateCampaign(id, req.body, version, actorFromRequest(req)));
});
router.post("/campaigns/:id/duplicate", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const source = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const duplicate = await prisma.campaign.create({
    data: {
      name: `${source.name} (Copy)`,
      type: source.type === "LEGACY_ARCHIVE" ? "LISTING" : source.type,
      status: "DRAFT",
      listingId: source.type === "LEGACY_ARCHIVE" ? null : source.listingId,
      senderProfileId: source.senderProfileId,
      replyToAgentId: source.replyToAgentId,
      savedAudienceId: source.savedAudienceId,
      templateKey: source.templateKey,
      subject: source.subject,
      preheader: source.preheader,
      introHtml: source.introHtml,
      introText: source.introText,
      ctaLabel: source.ctaLabel,
      ctaUrl: source.ctaUrl,
      audienceFilter: source.audienceFilter as Prisma.InputJsonValue,
      timezone: source.timezone,
      createdByUserId: req.user!.id,
      updatedByUserId: req.user!.id,
    },
  });
  res.status(201).json(duplicate);
});
router.post("/campaigns/:id/preview", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(
    await previewCampaign(
      id,
      z
        .object({
          firstName: z.string().optional(),
          fullName: z.string().optional(),
          company: z.string().optional(),
        })
        .parse(req.body)
    )
  );
});
router.post("/campaigns/:id/test-send", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = testSendSchema.parse(req.body);
  res.json(await testSendCampaign(id, input.email, input.version, actorFromRequest(req)));
});
router.post("/campaigns/:id/mark-ready", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await markCampaignReady(id, actorFromRequest(req)));
});
router.post("/campaigns/:id/schedule", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = campaignActionSchema.parse(req.body);
  if (!input.scheduledAt) throw new DomainError("SCHEDULE_REQUIRED", "scheduledAt is required.");
  res
    .status(202)
    .json(
      await queueCampaignSnapshot(
        id,
        actorFromRequest(req),
        input.version,
        new Date(input.scheduledAt),
        req.get("idempotency-key") ?? undefined
      )
    );
});
router.post("/campaigns/:id/send-now", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const input = campaignActionSchema.parse(req.body);
  res
    .status(202)
    .json(
      await queueCampaignSnapshot(
        id,
        actorFromRequest(req),
        input.version,
        undefined,
        req.get("idempotency-key") ?? undefined
      )
    );
});
for (const action of ["pause", "resume", "cancel"] as const)
  router.post(`/campaigns/:id/${action}`, requireRole("ADMIN", "MARKETER"), async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await transitionCampaign(id, action, actorFromRequest(req)));
  });
router.get("/campaigns/:id/stats", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await recomputeCampaignStats(id));
});
router.get("/campaigns/:id/recipients", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const page = paginationSchema.parse(req.query);
  const filter = recipientFilterSchema.parse(req.query);
  const where = { campaignId: id, ...filter };
  const [items, total] = await prisma.$transaction([
    prisma.campaignRecipient.findMany({
      where,
      skip: (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: { createdAt: "asc" },
    }),
    prisma.campaignRecipient.count({ where }),
  ]);
  res.json({ items, total, page: page.page, limit: page.limit });
});
router.get("/campaigns/:id/recipients/:recipientId", async (req, res) => {
  const input = z.object({ id: z.uuid(), recipientId: z.uuid() }).parse(req.params);
  const item = await prisma.campaignRecipient.findUnique({
    where: { id: input.recipientId },
    include: {
      sendBatch: { include: { attempts: true } },
      emailEvents: { orderBy: { eventCreatedAt: "asc" } },
    },
  });
  if (!item || item.campaignId !== input.id)
    throw new DomainError("RECIPIENT_NOT_FOUND", "Campaign recipient not found.", 404);
  res.json(item);
});
router.get("/campaigns/:id/events", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({
    items: await prisma.emailEvent.findMany({
      where: { campaignRecipient: { campaignId: id } },
      orderBy: { eventCreatedAt: "desc" },
      take: 500,
    }),
  });
});
router.get("/campaigns/:id/export.csv", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const filter = recipientFilterSchema.parse(req.query);
  const where = { campaignId: id, ...filter };
  const rowCount = await prisma.campaignRecipient.count({ where });
  await prisma.auditLog.create({
    data: {
      actorUserId: req.user?.id,
      action: "campaign_recipients.export",
      entityType: "campaign",
      entityId: id,
      requestId: String(req.id ?? "unknown"),
      after: { rowCount },
    },
  });
  res.type("text/csv").attachment(`campaign-${id}.csv`);
  if (
    !(await writeResponseChunk(
      res,
      "email,name,company,send_state,delivery_state,attempts,last_error\n"
    ))
  )
    return;
  let cursor: string | undefined;
  while (true) {
    const items = await prisma.campaignRecipient.findMany({
      where,
      orderBy: { id: "asc" },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: 500,
      select: {
        id: true,
        email: true,
        displayName: true,
        company: true,
        sendState: true,
        deliveryState: true,
        attemptCount: true,
        lastErrorMessage: true,
      },
    });
    if (items.length === 0) break;
    for (const item of items) {
      const row = [
        item.email,
        item.displayName,
        item.company,
        item.sendState,
        item.deliveryState,
        item.attemptCount,
        item.lastErrorMessage,
      ]
        .map(escapeCsvCell)
        .join(",");
      if (!(await writeResponseChunk(res, `${row}\n`))) return;
    }
    if (items.length < 500) break;
    cursor = items.at(-1)?.id;
  }
  res.end();
});

router.get("/dashboard/summary", async (_req, res) => {
  res.json(await dashboardSummary());
});
router.get("/dashboard/recent-campaigns", async (_req, res) => {
  res.json({
    items: await prisma.campaign.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: { listing: { select: { title: true } } },
    }),
  });
});
router.get("/audit-logs", requireRole("ADMIN", "MARKETER"), async (req, res) => {
  const page = paginationSchema.parse(req.query);
  res.json({
    items: await prisma.auditLog.findMany({
      where: req.user?.role === "MARKETER" ? { actorUserId: req.user.id } : undefined,
      skip: (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { email: true, displayName: true } } },
    }),
  });
});
router.get("/system/readiness", requireRole("ADMIN"), async (_req, res) => {
  await checkDatabase();
  const [heartbeat, paused, recoveryGuard, deliverabilityAlert, sender, migrations] =
    await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: "WORKER_HEARTBEAT" } }),
      prisma.systemSetting.findUnique({ where: { key: "GLOBAL_SEND_PAUSED" } }),
      prisma.systemSetting.findUnique({ where: { key: "RECOVERY_GUARD" } }),
      prisma.systemSetting.findUnique({ where: { key: "DELIVERABILITY_ALERT" } }),
      prisma.senderProfile.findFirst({ where: { isDefault: true } }),
      prisma.$queryRaw<
        Array<{ migration_name: string }>
      >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
    ]);
  res.json({
    database: "ready",
    migration: migrations[0]?.migration_name ?? null,
    storage: config.storageProvider,
    deliveryMode: config.deliveryMode,
    companyAddressConfigured: !/REQUIRED|PLACEHOLDER/i.test(config.companyPostalAddress),
    defaultSenderVerified: sender?.verificationStatus === "VERIFIED",
    globalSendPaused: paused?.value ?? true,
    recoveryGuard: recoveryGuard?.value ?? { required: true },
    deliverabilityAlert: deliverabilityAlert?.value ?? { actionRequired: false },
    workerHeartbeat: heartbeat?.value ?? null,
  });
});
for (const [action, paused] of [
  ["pause", true],
  ["resume", false],
] as const) {
  router.post(`/system/sending/${action}`, requireRole("ADMIN"), async (req, res) => {
    const input = z
      .object({
        reason: z.string().trim().min(5).max(500),
        recoveryReconciled: z.boolean().default(false),
      })
      .parse(req.body);
    if (action === "resume") {
      const guard = await prisma.systemSetting.findUnique({ where: { key: "RECOVERY_GUARD" } });
      const required =
        guard?.value &&
        typeof guard.value === "object" &&
        !Array.isArray(guard.value) &&
        "required" in guard.value &&
        guard.value.required === true;
      if (required && !input.recoveryReconciled)
        throw new DomainError(
          "RECOVERY_RECONCILIATION_REQUIRED",
          "Confirm database recovery reconciliation before resuming delivery.",
          409
        );
    }
    const setting = await inTransaction(async (tx) => {
      const updated = await tx.systemSetting.upsert({
        where: { key: "GLOBAL_SEND_PAUSED" },
        create: { key: "GLOBAL_SEND_PAUSED", value: paused },
        update: { value: paused },
      });
      if (action === "resume" && input.recoveryReconciled) {
        await tx.systemSetting.upsert({
          where: { key: "RECOVERY_GUARD" },
          create: {
            key: "RECOVERY_GUARD",
            value: { required: false, reconciledAt: new Date().toISOString() },
          },
          update: { value: { required: false, reconciledAt: new Date().toISOString() } },
        });
      }
      await writeAudit(tx, actorFromRequest(req), {
        action: `system.sending_${action}`,
        entityType: "system_setting",
        entityId: updated.key,
        after: { paused, reason: input.reason, recoveryReconciled: input.recoveryReconciled },
      });
      return updated;
    });
    res.json({ globalSendPaused: setting.value });
  });
}

export { router as v2Router, assetStorage };

export const localDevLoginRouter = Router();
localDevLoginRouter.post("/auth/dev-login", async (req, res) => {
  const input = z.object({ email: z.email() }).parse(req.body);
  const user = await resolveLocalUser(input.email);
  const token = createLocalSession(user.emailNormalized, config.sessionSecret);
  res.cookie("homix_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    maxAge: 43_200_000,
    path: "/",
  });
  res.json({
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
  });
});
