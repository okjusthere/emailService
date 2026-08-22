import "dotenv/config";
import Database from "better-sqlite3";
import type { SuppressionReason } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { normalizeEmail, normalizeName } from "../src/shared/normalize.js";
import type { AssetStorage } from "../src/storage/AssetStorage.js";

interface LegacySubscriber {
  id: number;
  email: string;
  name: string | null;
  status: string;
  last_sent_at: string | null;
  send_count: number;
  created_at: string | null;
  updated_at: string | null;
}
interface LegacyTag {
  id: number;
  name: string;
  color: string | null;
}
interface LegacySubscriberTag {
  subscriber_id: number;
  tag_id: number;
}
interface LegacyCampaign {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  sent_at: string | null;
}

function parseArgs(argv: string[]) {
  const value = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const sqlite = value("--sqlite");
  if (!sqlite)
    throw new Error(
      "Usage: --sqlite <absolute-path> [--assets-root <absolute-path>] [--dry-run|--apply] [--report <path>]"
    );
  if (!isAbsolute(sqlite)) throw new Error("--sqlite must be an absolute path");
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) throw new Error("Choose either --dry-run or --apply");
  const assetsRoot = value("--assets-root") ?? resolve(dirname(sqlite), "email-assets");
  if (!isAbsolute(assetsRoot)) throw new Error("--assets-root must be an absolute path");
  return { sqlite, assetsRoot, apply, report: value("--report") ?? "migration-report.json" };
}

const assetAttribute = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi;

function detectLegacyAssetType(
  buffer: Buffer
): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf" : null;
}

function referencedAssets(campaigns: LegacyCampaign[]): string[] {
  const references = new Set<string>();
  for (const campaign of campaigns) {
    for (const match of campaign.body_html.matchAll(assetAttribute)) {
      const value = match[2];
      if (!value || /^(?:https?:|data:|cid:|mailto:|#)/i.test(value)) continue;
      references.add(value);
    }
  }
  return [...references];
}

function resolveLegacyAsset(root: string, reference: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0] ?? "");
  } catch {
    return null;
  }
  const normalized = decoded
    .replace(/^\/(?:api\/admin\/email-assets|public\/assets)\//, "")
    .replace(/^\/+/, "");
  if (!normalized) return null;
  const target = resolve(root, normalized);
  const withinRoot = relative(root, target);
  return withinRoot && !withinRoot.startsWith(`..${sep}`) && withinRoot !== ".." ? target : null;
}

async function inspectLegacyAssets(campaigns: LegacyCampaign[], root: string) {
  const inspected: Array<{
    reference: string;
    sourcePath: string | null;
    buffer?: Buffer;
    contentType?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
    checksum?: string;
    error?: string;
  }> = [];
  for (const reference of referencedAssets(campaigns)) {
    const sourcePath = resolveLegacyAsset(root, reference);
    if (!sourcePath) {
      inspected.push({ reference, sourcePath, error: "unsafe_or_unresolvable_path" });
      continue;
    }
    try {
      const buffer = await readFile(sourcePath);
      const contentType = detectLegacyAssetType(buffer);
      if (!contentType) {
        inspected.push({ reference, sourcePath, error: "unsupported_file_type" });
        continue;
      }
      inspected.push({
        reference,
        sourcePath,
        buffer,
        contentType,
        checksum: createHash("sha256").update(buffer).digest("hex"),
      });
    } catch (error) {
      inspected.push({
        reference,
        sourcePath,
        error: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing_file" : "read_error",
      });
    }
  }
  return inspected;
}

async function uploadLegacyAssets(
  inspected: Awaited<ReturnType<typeof inspectLegacyAssets>>,
  storage: AssetStorage
): Promise<Map<string, string>> {
  const migrated = new Map<string, string>();
  const byChecksum = new Map<string, string>();
  for (const item of inspected) {
    if (!item.buffer || !item.contentType || !item.checksum) continue;
    const existing = byChecksum.get(item.checksum);
    if (existing) {
      migrated.set(item.reference, existing);
      continue;
    }
    const isPdf = item.contentType === "application/pdf";
    const output = isPdf
      ? item.buffer
      : await sharp(item.buffer, { failOn: "warning" })
          .rotate()
          .resize({ width: 1200, height: 675, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
    const outputChecksum = createHash("sha256").update(output).digest("hex");
    const blobName = isPdf ? `legacy/${outputChecksum}.pdf` : `legacy/${outputChecksum}.jpg`;
    try {
      await storage.put({
        blobName,
        buffer: output,
        contentType: isPdf ? "application/pdf" : "image/jpeg",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const publicUrl = storage.getPublicUrl(blobName);
    byChecksum.set(item.checksum, publicUrl);
    migrated.set(item.reference, publicUrl);
  }
  return migrated;
}

function replaceAssetReferences(html: string, migrated: Map<string, string>): string {
  return html.replace(assetAttribute, (attribute, quote: string, reference: string) => {
    const publicUrl = migrated.get(reference);
    return publicUrl
      ? attribute.replace(`${quote}${reference}${quote}`, `${quote}${publicUrl}${quote}`)
      : attribute;
  });
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

function suppressionFor(status: string): SuppressionReason | null {
  return (
    (
      {
        unsubscribed: "UNSUBSCRIBE",
        bounced: "LEGACY_BOUNCE_REVIEW",
        complained: "COMPLAINT",
        suppressed: "PROVIDER_SUPPRESSED",
      } as const
    )[status] ?? null
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const legacy = new Database(args.sqlite, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(legacy, "subscribers"))
      throw new Error("Legacy subscribers table was not found");
    const subscribers = legacy
      .prepare(
        "SELECT id,email,name,status,last_sent_at,send_count,created_at,updated_at FROM subscribers"
      )
      .all() as LegacySubscriber[];
    const tags = tableExists(legacy, "tags")
      ? (legacy.prepare("SELECT id,name,color FROM tags").all() as LegacyTag[])
      : [];
    const subscriberTags = tableExists(legacy, "subscriber_tags")
      ? (legacy
          .prepare("SELECT subscriber_id,tag_id FROM subscriber_tags")
          .all() as LegacySubscriberTag[])
      : [];
    const campaigns = tableExists(legacy, "campaigns")
      ? (legacy
          .prepare(
            "SELECT id,name,subject,body_html,body_text,status,created_at,updated_at,sent_at FROM campaigns"
          )
          .all() as LegacyCampaign[])
      : [];
    const inspectedAssets = await inspectLegacyAssets(campaigns, args.assetsRoot);
    const invalid: Array<{ legacyId: number; reason: string }> = [];
    const normalized = subscribers.flatMap((subscriber) => {
      try {
        return [{ subscriber, emailNormalized: normalizeEmail(subscriber.email) }];
      } catch {
        invalid.push({ legacyId: subscriber.id, reason: "invalid email" });
        return [];
      }
    });
    const report = {
      mode: args.apply ? "apply" : "dry-run",
      subscribers: subscribers.length,
      validContacts: normalized.length,
      invalidContacts: invalid.length,
      skippedContacts: invalid.length,
      conflicts: 0,
      tags: tags.length,
      contactTagLinks: subscriberTags.length,
      suppressions: normalized.filter(({ subscriber }) => suppressionFor(subscriber.status)).length,
      legacyCampaigns: campaigns.length,
      referencedAssets: inspectedAssets.length,
      migratableAssets: inspectedAssets.filter((item) => !item.error).length,
      missingAssets: inspectedAssets.filter((item) => item.error).length,
      warnings: [
        "Legacy bounced status is conservatively mapped to LEGACY_BOUNCE_REVIEW.",
        "Legacy send logs are not treated as V2 recipient snapshots.",
      ],
      invalidRows: invalid,
      assetErrors: inspectedAssets
        .filter((item) => item.error)
        .map((item) => ({ reference: item.reference, reason: item.error })),
      applyErrors: [] as Array<{ entity: string; legacyId: string | number; reason: string }>,
    };
    if (args.apply) {
      const prisma = new PrismaClient();
      try {
        const adminEmail = (process.env.LOCAL_ADMIN_EMAIL ?? "admin@homixny.com")
          .trim()
          .toLowerCase();
        const actor = await prisma.user.upsert({
          where: { emailNormalized: adminEmail },
          create: {
            email: adminEmail,
            emailNormalized: adminEmail,
            displayName: "Legacy Migration",
            role: "ADMIN",
          },
          update: {},
        });
        const sender = await prisma.senderProfile.upsert({
          where: { fromEmailNormalized: "listings@listings.homixny.com" },
          create: {
            name: "Homix Listings",
            fromName: "Homix Realty",
            fromEmail: "listings@listings.homixny.com",
            fromEmailNormalized: "listings@listings.homixny.com",
            domain: "listings.homixny.com",
            isDefault: true,
          },
          update: {},
        });
        const { createAssetStorage } = await import("../src/storage/index.js");
        const migratedAssets = await uploadLegacyAssets(inspectedAssets, createAssetStorage());
        const tagMap = new Map<number, string>();
        for (const tag of tags) {
          try {
            const saved = await prisma.tag.upsert({
              where: { normalizedName: normalizeName(tag.name) },
              create: {
                name: tag.name,
                normalizedName: normalizeName(tag.name),
                color: tag.color ?? "#64748b",
              },
              update: { name: tag.name },
            });
            tagMap.set(tag.id, saved.id);
          } catch (error) {
            report.applyErrors.push({
              entity: "tag",
              legacyId: tag.id,
              reason: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
            });
          }
        }
        const contactMap = new Map<number, string>();
        for (const { subscriber, emailNormalized } of normalized) {
          try {
            const contact = await prisma.$transaction(async (tx) => {
              const saved = await tx.contact.upsert({
                where: { emailNormalized },
                create: {
                  email: subscriber.email.trim(),
                  emailNormalized,
                  displayName: subscriber.name,
                  sourceType: "LEGACY_EMAIL_SERVICE",
                  permissionBasis: "UNKNOWN",
                  lastSentAt: subscriber.last_sent_at ? new Date(subscriber.last_sent_at) : null,
                  sendCount: subscriber.send_count ?? 0,
                  createdAt: subscriber.created_at ? new Date(subscriber.created_at) : undefined,
                },
                update: {
                  displayName: subscriber.name || undefined,
                  lastSentAt: subscriber.last_sent_at
                    ? new Date(subscriber.last_sent_at)
                    : undefined,
                  sendCount: subscriber.send_count ?? undefined,
                },
              });
              const reason = suppressionFor(subscriber.status);
              if (reason)
                await tx.suppression.upsert({
                  where: { emailNormalized },
                  create: {
                    email: subscriber.email.trim(),
                    emailNormalized,
                    reason,
                    source: "IMPORT",
                    details: { legacyStatus: subscriber.status },
                  },
                  update: { isActive: true, reason },
                });
              return saved;
            });
            contactMap.set(subscriber.id, contact.id);
          } catch (error) {
            report.applyErrors.push({
              entity: "contact",
              legacyId: subscriber.id,
              reason: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
            });
          }
        }
        for (const link of subscriberTags) {
          const contactId = contactMap.get(link.subscriber_id);
          const tagId = tagMap.get(link.tag_id);
          if (contactId && tagId)
            await prisma.contactTag.upsert({
              where: { contactId_tagId: { contactId, tagId } },
              create: { contactId, tagId },
              update: {},
            });
        }
        for (const campaign of campaigns) {
          try {
            await prisma.campaign.upsert({
              where: { id: campaign.id },
              create: {
                id: campaign.id,
                name: campaign.name,
                type: "LEGACY_ARCHIVE",
                status: "ARCHIVED",
                senderProfileId: sender.id,
                templateKey: "BROKER_PERSONAL",
                subject: campaign.subject || "Legacy campaign",
                introHtml: replaceAssetReferences(campaign.body_html, migratedAssets) || null,
                introText: campaign.body_text || null,
                audienceFilter: { legacy: true },
                contentSnapshot: {
                  legacy: true,
                  originalStatus: campaign.status,
                  migratedAssetCount: migratedAssets.size,
                },
                createdByUserId: actor.id,
                updatedByUserId: actor.id,
                createdAt: campaign.created_at ? new Date(campaign.created_at) : undefined,
                completedAt: campaign.sent_at ? new Date(campaign.sent_at) : null,
              },
              update: {},
            });
          } catch (error) {
            report.applyErrors.push({
              entity: "campaign",
              legacyId: campaign.id,
              reason: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
            });
          }
        }
        report.conflicts = report.applyErrors.length;
        await prisma.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "legacy_migration.apply",
            entityType: "migration",
            after: {
              contacts: normalized.length,
              suppressions: report.suppressions,
              campaigns: campaigns.length,
              migratedAssets: report.migratableAssets,
            },
          },
        });
      } finally {
        await prisma.$disconnect();
      }
    }
    await writeFile(args.report, JSON.stringify(report, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    process.stdout.write(
      JSON.stringify({
        report: resolve(args.report),
        mode: report.mode,
        counts: {
          contacts: report.validContacts,
          invalid: report.invalidContacts,
          suppressions: report.suppressions,
          campaigns: report.legacyCampaigns,
          assets: report.migratableAssets,
          missingAssets: report.missingAssets,
        },
      }) + "\n"
    );
  } finally {
    legacy.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`
  );
  process.exitCode = 1;
});
