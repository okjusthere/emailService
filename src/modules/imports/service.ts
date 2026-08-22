import { ContactSourceType, ContactType, PermissionBasis, Prisma } from "@prisma/client";
import { parse } from "csv-parse";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { inTransaction } from "../../db/transactions.js";
import { DomainError } from "../../shared/errors.js";
import {
  escapeCsvCell,
  normalizeEmail,
  normalizeName,
  sanitizeErrorMessage,
} from "../../shared/normalize.js";
import { getPrivateObjectStorage } from "../../storage/PrivateObjectStorage.js";

const metadataSchema = z.object({
  sourceType: z.enum(ContactSourceType),
  permissionBasis: z.enum(PermissionBasis),
  sourceDetail: z.string().max(500).optional(),
});
const rowSchema = z
  .object({
    email: z.string(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    name: z.string().optional(),
    company: z.string().optional(),
    title: z.string().optional(),
    phone: z.string().optional(),
    contact_type: z.string().optional(),
    source_detail: z.string().optional(),
    permission_basis: z.string().optional(),
    markets: z.string().optional(),
    property_interests: z.string().optional(),
    tags: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();
type CsvRow = z.infer<typeof rowSchema>;

const canonicalColumns = [
  "email",
  "first_name",
  "last_name",
  "name",
  "company",
  "title",
  "phone",
  "contact_type",
  "source_detail",
  "permission_basis",
  "markets",
  "property_interests",
  "tags",
  "notes",
] as const;
type CanonicalColumn = (typeof canonicalColumns)[number];
const columnMappingSchema = z
  .partialRecord(z.enum(canonicalColumns), z.string().trim().min(1))
  .refine((mapping) => Boolean(mapping.email), "Map an email column before validation");
const savedMappingSchema = z.object({
  columns: columnMappingSchema,
  unknownReferences: z
    .object({
      tags: z.array(z.string()),
      markets: z.array(z.string()),
      propertyInterests: z.array(z.string()),
    })
    .default({ tags: [], markets: [], propertyInterests: [] }),
  createUnknownReferences: z.boolean().default(false),
});
export type ContactImportColumnMapping = Partial<Record<CanonicalColumn, string>>;

async function* parseRawRows(stream: Readable): AsyncGenerator<Record<string, string>> {
  const parser = stream.pipe(
    parse({
      bom: true,
      columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    })
  );
  let count = 0;
  for await (const value of parser) {
    count += 1;
    if (count > 50_000) throw new Error("CSV exceeds 50,000 row limit");
    yield z.record(z.string(), z.coerce.string()).parse(value);
  }
}

async function* parseRows(
  stream: Readable,
  mapping: ContactImportColumnMapping = Object.fromEntries(
    canonicalColumns.map((column) => [column, column])
  )
): AsyncGenerator<CsvRow> {
  for await (const raw of parseRawRows(stream)) {
    const mapped = Object.fromEntries(
      canonicalColumns.map((column) => [
        column,
        mapping[column] ? (raw[mapping[column]!.trim().toLowerCase()] ?? "") : "",
      ])
    );
    yield rowSchema.parse(mapped);
  }
}

function splitList(value?: string): string[] {
  return (value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function previewContactImport(importId: string) {
  const item = await prisma.contactImport.findUniqueOrThrow({ where: { id: importId } });
  if (!item.blobName) throw new Error("Import file is missing");
  const stream = await getPrivateObjectStorage().open(item.blobName);
  let headers: string[] = [];
  const preview: Array<Record<string, string>> = [];
  for await (const row of parseRawRows(stream)) {
    if (headers.length === 0) headers = Object.keys(row);
    if (preview.length < 10)
      preview.push(
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            key.includes("email") ? value.replace(/^(.).+(@.*)$/, "$1***$2") : value.slice(0, 100),
          ])
        )
      );
    if (preview.length === 10) break;
  }
  const mapping = Object.fromEntries(
    canonicalColumns.filter((column) => headers.includes(column)).map((column) => [column, column])
  ) as ContactImportColumnMapping;
  return { headers, mapping, preview };
}

export async function validateContactImport(
  importId: string,
  mappingInput?: ContactImportColumnMapping
) {
  const item = await prisma.contactImport.findUniqueOrThrow({ where: { id: importId } });
  if (!item.blobName) throw new Error("Import file is missing");
  const previewResult = await previewContactImport(importId);
  const mapping = columnMappingSchema.parse(mappingInput ?? previewResult.mapping);
  const normalizedMapping = Object.fromEntries(
    Object.entries(mapping).map(([column, header]) => [column, header.trim().toLowerCase()])
  ) as Record<CanonicalColumn, string>;
  for (const header of Object.values(normalizedMapping))
    if (!previewResult.headers.includes(header))
      throw new Error(`Mapped CSV column not found: ${header}`);
  const seen = new Set<string>();
  let totalRows = 0;
  let invalid = 0;
  let duplicates = 0;
  const preview: Array<Record<string, string>> = [];
  const references = {
    tags: new Set<string>(),
    markets: new Set<string>(),
    propertyInterests: new Set<string>(),
  };
  const stream = await getPrivateObjectStorage().open(item.blobName);
  for await (const row of parseRows(stream, normalizedMapping)) {
    totalRows += 1;
    for (const value of splitList(row.tags)) references.tags.add(normalizeName(value));
    for (const value of splitList(row.markets))
      references.markets.add(normalizeName(value).replace(/[^a-z0-9]+/g, "-"));
    for (const value of splitList(row.property_interests))
      references.propertyInterests.add(normalizeName(value).replace(/[^a-z0-9]+/g, "-"));
    try {
      const email = normalizeEmail(row.email);
      if (seen.has(email)) duplicates += 1;
      else seen.add(email);
      if (preview.length < 10)
        preview.push({
          email: email.replace(/^(.).+(@.*)$/, "$1***$2"),
          name: row.name ?? [row.first_name, row.last_name].filter(Boolean).join(" "),
          company: row.company ?? "",
        });
    } catch {
      invalid += 1;
    }
  }
  const suppressions = await prisma.suppression.count({
    where: { isActive: true, emailNormalized: { in: [...seen] } },
  });
  const [knownTags, knownMarkets, knownInterests] = await Promise.all([
    prisma.tag.findMany({
      where: { normalizedName: { in: [...references.tags] } },
      select: { normalizedName: true },
    }),
    prisma.market.findMany({
      where: { slug: { in: [...references.markets] } },
      select: { slug: true },
    }),
    prisma.propertyInterest.findMany({
      where: { slug: { in: [...references.propertyInterests] } },
      select: { slug: true },
    }),
  ]);
  const knownTagNames = new Set(knownTags.map((value) => value.normalizedName));
  const knownMarketSlugs = new Set(knownMarkets.map((value) => value.slug));
  const knownInterestSlugs = new Set(knownInterests.map((value) => value.slug));
  const unknownReferences = {
    tags: [...references.tags].filter((value) => !knownTagNames.has(value)),
    markets: [...references.markets].filter((value) => !knownMarketSlugs.has(value)),
    propertyInterests: [...references.propertyInterests].filter(
      (value) => !knownInterestSlugs.has(value)
    ),
  };
  await prisma.contactImport.update({
    where: { id: importId },
    data: {
      status: "READY",
      totalRows,
      invalidCount: invalid,
      skippedCount: duplicates,
      suppressedCount: suppressions,
      mapping: { columns: normalizedMapping, unknownReferences, createUnknownReferences: false },
    },
  });
  return {
    totalRows,
    valid: totalRows - invalid - duplicates,
    invalid,
    duplicates,
    suppressed: suppressions,
    headers: previewResult.headers,
    mapping: normalizedMapping,
    unknownReferences,
    preview,
  };
}

export function confirmedImportMapping(
  value: Prisma.JsonValue | null,
  confirmCreateUnknownReferences: boolean
) {
  const mapping = savedMappingSchema.parse(value);
  const unknownCount =
    mapping.unknownReferences.tags.length +
    mapping.unknownReferences.markets.length +
    mapping.unknownReferences.propertyInterests.length;
  if (unknownCount > 0 && !confirmCreateUnknownReferences)
    throw new Error(
      "Confirm creation of unknown tags, markets, and property interests before apply"
    );
  return { ...mapping, createUnknownReferences: confirmCreateUnknownReferences };
}

export async function queueContactImport(
  importId: string,
  confirmCreateUnknownReferences: boolean
) {
  return inTransaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM contact_imports WHERE id = ${importId}::uuid FOR UPDATE
    `);
    const item = await tx.contactImport.findUnique({ where: { id: importId } });
    if (!item) throw new DomainError("IMPORT_NOT_FOUND", "Import not found.", 404);

    if (item.status === "PROCESSING") {
      const existingJob = await tx.job.findUnique({
        where: { uniqueKey: `IMPORT_CONTACTS/${importId}` },
      });
      if (!existingJob)
        throw new DomainError(
          "IMPORT_JOB_MISSING",
          "Import is processing but its durable job is missing.",
          409
        );
      return { id: importId, status: item.status, alreadyProcessing: true };
    }
    if (item.status !== "READY" && item.status !== "FAILED")
      throw new DomainError("IMPORT_INVALID_STATE", "Import must be validated before apply.", 409);

    let mapping: ReturnType<typeof confirmedImportMapping>;
    try {
      mapping = confirmedImportMapping(item.mapping, confirmCreateUnknownReferences);
    } catch (error) {
      throw new DomainError(
        "IMPORT_MAPPING_CONFIRMATION_REQUIRED",
        error instanceof Error ? error.message : "Confirm the saved import mapping before apply.",
        409
      );
    }

    const claimed = await tx.contactImport.updateMany({
      where: { id: importId, status: { in: ["READY", "FAILED"] } },
      data: { status: "PROCESSING", mapping },
    });
    if (claimed.count !== 1)
      throw new DomainError("IMPORT_STATE_CHANGED", "Import state changed while applying.", 409);

    await tx.job.upsert({
      where: { uniqueKey: `IMPORT_CONTACTS/${importId}` },
      create: {
        type: "IMPORT_CONTACTS",
        uniqueKey: `IMPORT_CONTACTS/${importId}`,
        payload: { importId },
      },
      update: {
        status: "PENDING",
        runAt: new Date(),
        attempts: 0,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        lastError: null,
        completedAt: null,
      },
    });
    return { id: importId, status: "PROCESSING" as const, alreadyProcessing: false };
  });
}

interface ReferenceCache {
  tags: Map<string, string>;
  markets: Map<string, string>;
  interests: Map<string, string>;
}

async function cachedReference(
  cache: Map<string, string>,
  key: string,
  create: () => Promise<{ id: string }>
): Promise<string> {
  const existing = cache.get(key);
  if (existing) return existing;
  const created = await create();
  cache.set(key, created.id);
  return created.id;
}

async function referenceIds(tx: Prisma.TransactionClient, row: CsvRow, cache: ReferenceCache) {
  const tagIds: string[] = [];
  const marketIds: string[] = [];
  const propertyInterestIds: string[] = [];
  for (const name of splitList(row.tags)) {
    const normalizedName = normalizeName(name);
    tagIds.push(
      await cachedReference(cache.tags, normalizedName, () =>
        tx.tag.upsert({
          where: { normalizedName },
          create: { name, normalizedName },
          update: { isActive: true },
        })
      )
    );
  }
  for (const name of splitList(row.markets)) {
    const slug = normalizeName(name).replace(/[^a-z0-9]+/g, "-");
    marketIds.push(
      await cachedReference(cache.markets, slug, () =>
        tx.market.upsert({
          where: { slug },
          create: { name, slug, type: "CUSTOM" },
          update: { isActive: true },
        })
      )
    );
  }
  for (const name of splitList(row.property_interests)) {
    const slug = normalizeName(name).replace(/[^a-z0-9]+/g, "-");
    propertyInterestIds.push(
      await cachedReference(cache.interests, slug, () =>
        tx.propertyInterest.upsert({
          where: { slug },
          create: { name, slug },
          update: { isActive: true },
        })
      )
    );
  }
  return { tagIds, marketIds, propertyInterestIds };
}

async function importCounts(importId: string) {
  const [groups, totalRows, suppressedCount] = await Promise.all([
    prisma.contactImportRow.groupBy({
      by: ["outcome"],
      where: { contactImportId: importId },
      _count: { _all: true },
    }),
    prisma.contactImportRow.count({ where: { contactImportId: importId } }),
    prisma.contactImportRow.count({ where: { contactImportId: importId, suppressed: true } }),
  ]);
  const countByOutcome = new Map(groups.map((group) => [group.outcome, group._count._all]));
  return {
    totalRows,
    createdCount: countByOutcome.get("CREATED") ?? 0,
    updatedCount: countByOutcome.get("UPDATED") ?? 0,
    skippedCount: countByOutcome.get("SKIPPED") ?? 0,
    invalidCount: countByOutcome.get("INVALID") ?? 0,
    suppressedCount,
  };
}

async function writeErrorReport(importId: string, fatalError?: unknown): Promise<string> {
  const invalidRows = await prisma.contactImportRow.findMany({
    where: { contactImportId: importId, outcome: "INVALID" },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, rawEmail: true, errorMessage: true },
  });
  const lines = [
    "row,email,error",
    ...invalidRows.map((row) =>
      [row.rowNumber + 1, row.rawEmail, row.errorMessage].map(escapeCsvCell).join(",")
    ),
  ];
  if (fatalError)
    lines.push(["", "", sanitizeErrorMessage(fatalError)].map(escapeCsvCell).join(","));
  const reportName = `import-reports/${randomUUID()}.csv`;
  await getPrivateObjectStorage().put(reportName, Buffer.from(lines.join("\n")), "text/csv");
  return reportName;
}

export async function processContactImport(importId: string): Promise<void> {
  const item = await prisma.contactImport.findUniqueOrThrow({ where: { id: importId } });
  if (!item.blobName) throw new Error("Import file is missing");
  const metadata = metadataSchema.parse(item.sourceMetadata);
  const savedMapping = item.mapping
    ? savedMappingSchema.parse(item.mapping)
    : savedMappingSchema.parse({
        columns: Object.fromEntries(canonicalColumns.map((column) => [column, column])),
      });
  const seen = new Set<string>();
  const referenceCache: ReferenceCache = {
    tags: new Map(),
    markets: new Map(),
    interests: new Map(),
  };
  const completedRows = new Map(
    (
      await prisma.contactImportRow.findMany({
        where: { contactImportId: importId },
        select: { rowNumber: true, emailNormalized: true },
      })
    ).map((row) => [row.rowNumber, row.emailNormalized])
  );

  try {
    let rowNumber = 0;
    const stream = await getPrivateObjectStorage().open(item.blobName);
    for await (const row of parseRows(stream, savedMapping.columns)) {
      rowNumber += 1;
      const completedEmail = completedRows.get(rowNumber);
      if (completedRows.has(rowNumber)) {
        if (completedEmail) seen.add(completedEmail);
        continue;
      }

      let emailNormalized: string;
      try {
        emailNormalized = normalizeEmail(row.email);
      } catch {
        await prisma.contactImportRow.create({
          data: {
            contactImportId: importId,
            rowNumber,
            rawEmail: row.email,
            outcome: "INVALID",
            errorMessage: "invalid email",
          },
        });
        continue;
      }
      if (seen.has(emailNormalized)) {
        await prisma.contactImportRow.create({
          data: { contactImportId: importId, rowNumber, emailNormalized, outcome: "SKIPPED" },
        });
        continue;
      }
      seen.add(emailNormalized);

      const committedCache = await inTransaction(async (tx) => {
        const transactionCache: ReferenceCache = {
          tags: new Map(referenceCache.tags),
          markets: new Map(referenceCache.markets),
          interests: new Map(referenceCache.interests),
        };
        const alreadyProcessed = await tx.contactImportRow.findUnique({
          where: { contactImportId_rowNumber: { contactImportId: importId, rowNumber } },
        });
        if (alreadyProcessed) return transactionCache;
        const existing = await tx.contact.findUnique({ where: { emailNormalized } });
        const refs = await referenceIds(tx, row, transactionCache);
        const rowPermission =
          z.enum(PermissionBasis).safeParse(row.permission_basis?.toUpperCase()).data ??
          metadata.permissionBasis;
        const rowType =
          z.enum(ContactType).safeParse(row.contact_type?.toUpperCase()).data ?? ContactType.OTHER;
        const data = {
          email: row.email.trim(),
          emailNormalized,
          firstName: row.first_name || undefined,
          lastName: row.last_name || undefined,
          displayName: row.name || undefined,
          company: row.company || undefined,
          jobTitle: row.title || undefined,
          phone: row.phone || undefined,
          contactType: rowType,
          sourceType: metadata.sourceType,
          sourceDetail: row.source_detail || metadata.sourceDetail,
          permissionBasis: rowPermission,
          notes: row.notes || undefined,
        };
        const contact = await tx.contact.upsert({
          where: { emailNormalized },
          create: data,
          update: Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined)
          ),
        });
        await Promise.all([
          refs.tagIds.length
            ? tx.contactTag.createMany({
                data: refs.tagIds.map((tagId) => ({ contactId: contact.id, tagId })),
                skipDuplicates: true,
              })
            : Promise.resolve(),
          refs.marketIds.length
            ? tx.contactMarket.createMany({
                data: refs.marketIds.map((marketId) => ({ contactId: contact.id, marketId })),
                skipDuplicates: true,
              })
            : Promise.resolve(),
          refs.propertyInterestIds.length
            ? tx.contactPropertyInterest.createMany({
                data: refs.propertyInterestIds.map((propertyInterestId) => ({
                  contactId: contact.id,
                  propertyInterestId,
                })),
                skipDuplicates: true,
              })
            : Promise.resolve(),
        ]);
        const suppressed = Boolean(
          await tx.suppression.findFirst({
            where: { emailNormalized, isActive: true },
            select: { id: true },
          })
        );
        await tx.contactImportRow.create({
          data: {
            contactImportId: importId,
            rowNumber,
            emailNormalized,
            outcome: existing ? "UPDATED" : "CREATED",
            suppressed,
          },
        });
        return transactionCache;
      });
      referenceCache.tags = committedCache.tags;
      referenceCache.markets = committedCache.markets;
      referenceCache.interests = committedCache.interests;
    }

    const counts = await importCounts(importId);
    const reportName = await writeErrorReport(importId);
    await prisma.$transaction([
      prisma.contactImport.update({
        where: { id: importId },
        data: { status: "COMPLETED", ...counts, errorReportUrl: reportName },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: item.createdByUserId,
          action: "contact_import.completed",
          entityType: "contact_import",
          entityId: importId,
          after: counts,
        },
      }),
    ]);
  } catch (error) {
    const counts = await importCounts(importId);
    let reportName: string | undefined;
    try {
      reportName = await writeErrorReport(importId, error);
    } catch {
      reportName = undefined;
    }
    await prisma.$transaction([
      prisma.contactImport.update({
        where: { id: importId },
        data: {
          status: "FAILED",
          ...counts,
          ...(reportName ? { errorReportUrl: reportName } : {}),
        },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: item.createdByUserId,
          action: "contact_import.failed",
          entityType: "contact_import",
          entityId: importId,
          after: { ...counts, error: sanitizeErrorMessage(error) },
        },
      }),
    ]);
    throw error;
  }
}
