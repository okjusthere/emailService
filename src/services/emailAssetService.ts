import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { Attachment } from "resend";
import { config } from "../config.js";

const DATA_DIR = config.dataDir;
const ASSET_DIR = path.join(DATA_DIR, "email-assets");
const ASSET_MANIFEST_PATH = path.join(DATA_DIR, "email_assets.json");

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ALLOWED_IMAGE_TYPES = new Set(Object.keys(IMAGE_MIME_TO_EXTENSION));

export const MAX_EMAIL_ASSET_SIZE = 5 * 1024 * 1024;

export interface EmailAssetRecord {
  id: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface EmailAssetSummary extends EmailAssetRecord {
  placeholder: string;
  publicPath: string;
  publicUrl: string;
}

export interface AssetResolutionResult {
  html: string;
  missingAssetIds: string[];
  usedAssetIds: string[];
}

export interface InlineAssetResolutionResult extends AssetResolutionResult {
  attachments: Attachment[];
}

export function isAllowedEmailAssetType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(mimeType);
}

export function buildEmailAssetPlaceholder(assetId: string): string {
  return `{{asset:${assetId}}}`;
}

export function buildEmailAssetPublicPath(asset: Pick<EmailAssetRecord, "fileName">): string {
  return `/email-assets/${asset.fileName}`;
}

export function hasEmbeddedAssets(html: string): boolean {
  return getUsedEmailAssetIds(html).length > 0;
}

export function getUsedEmailAssetIds(html: string): string[] {
  const ids = new Set<string>();

  for (const match of html.matchAll(/\{\{asset:([a-z0-9-]+)\}\}/gi)) {
    ids.add(match[1]);
  }

  return Array.from(ids);
}

export function listEmailAssets(baseUrl: string): EmailAssetSummary[] {
  return loadManifest().map((asset) => toSummary(asset, baseUrl));
}

export function createEmailAsset(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
  baseUrl: string;
}): EmailAssetSummary {
  validateEmailAsset(params.originalName, params.mimeType, params.size);
  ensureStorage();

  const id = randomUUID();
  const extension = IMAGE_MIME_TO_EXTENSION[params.mimeType];
  const fileName = `${id}.${extension}`;
  const filePath = path.join(ASSET_DIR, fileName);
  const manifest = loadManifest();

  fs.writeFileSync(filePath, params.buffer);

  const record: EmailAssetRecord = {
    id,
    originalName: sanitizeOriginalName(params.originalName, extension),
    fileName,
    mimeType: params.mimeType,
    size: params.size,
    createdAt: new Date().toISOString(),
  };

  manifest.unshift(record);
  saveManifest(manifest);

  return toSummary(record, params.baseUrl);
}

export function deleteEmailAsset(assetId: string): boolean {
  const manifest = loadManifest();
  const asset = manifest.find((item) => item.id === assetId);

  if (!asset) {
    return false;
  }

  const remainingAssets = manifest.filter((item) => item.id !== assetId);
  const filePath = path.join(ASSET_DIR, asset.fileName);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  saveManifest(remainingAssets);
  return true;
}

export function resolveAssetPlaceholdersToPublicUrls(
  html: string,
  baseUrl: string
): AssetResolutionResult {
  const assetsById = new Map(loadManifest().map((asset) => [asset.id, asset]));
  const missingAssetIds = new Set<string>();
  const usedAssetIds = new Set<string>();

  const resolvedHtml = html.replace(/\{\{asset:([a-z0-9-]+)\}\}/gi, (_match, assetId) => {
    usedAssetIds.add(assetId);
    const asset = assetsById.get(assetId);

    if (!asset) {
      missingAssetIds.add(assetId);
      return "";
    }

    return toSummary(asset, baseUrl).publicUrl;
  });

  return {
    html: resolvedHtml,
    missingAssetIds: Array.from(missingAssetIds),
    usedAssetIds: Array.from(usedAssetIds),
  };
}

export function resolveAssetPlaceholdersToInlineAttachments(
  html: string
): InlineAssetResolutionResult {
  const assetsById = new Map(loadManifest().map((asset) => [asset.id, asset]));
  const missingAssetIds = new Set<string>();
  const usedAssetIds = new Set<string>();
  const attachmentsById = new Map<
    string,
    { contentId: string; attachment: Attachment }
  >();

  const resolvedHtml = html.replace(/\{\{asset:([a-z0-9-]+)\}\}/gi, (_match, assetId) => {
    usedAssetIds.add(assetId);
    const asset = assetsById.get(assetId);

    if (!asset) {
      missingAssetIds.add(assetId);
      return "";
    }

    if (!attachmentsById.has(assetId)) {
      const filePath = path.join(ASSET_DIR, asset.fileName);

      if (!fs.existsSync(filePath)) {
        missingAssetIds.add(assetId);
        return "";
      }

      const contentId = `asset-${asset.id}@email-service`;
      attachmentsById.set(assetId, {
        contentId,
        attachment: {
          content: fs.readFileSync(filePath),
          contentId,
          contentType: asset.mimeType,
          filename: asset.originalName,
        },
      });
    }

    const prepared = attachmentsById.get(assetId);
    return prepared ? `cid:${prepared.contentId}` : "";
  });

  return {
    html: resolvedHtml,
    attachments: Array.from(attachmentsById.values()).map(
      (entry) => entry.attachment
    ),
    missingAssetIds: Array.from(missingAssetIds),
    usedAssetIds: Array.from(usedAssetIds),
  };
}

function validateEmailAsset(
  originalName: string,
  mimeType: string,
  size: number
): void {
  if (!isAllowedEmailAssetType(mimeType)) {
    throw new Error("Unsupported image type. Use PNG, JPG, GIF, or WebP.");
  }

  if (size <= 0) {
    throw new Error("Uploaded image is empty.");
  }

  if (size > MAX_EMAIL_ASSET_SIZE) {
    throw new Error("Image is too large. Max size is 5MB.");
  }

  if (!originalName.trim()) {
    throw new Error("Image name is required.");
  }
}

function sanitizeOriginalName(originalName: string, extension: string): string {
  const baseName = path.basename(originalName).replace(/[^\w.-]+/g, "-");
  const hasKnownExtension = baseName.toLowerCase().endsWith(`.${extension}`);
  return hasKnownExtension ? baseName : `${baseName}.${extension}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/g, "");
}

function toSummary(asset: EmailAssetRecord, baseUrl: string): EmailAssetSummary {
  const publicPath = buildEmailAssetPublicPath(asset);
  const safeBaseUrl = normalizeBaseUrl(baseUrl);

  return {
    ...asset,
    placeholder: buildEmailAssetPlaceholder(asset.id),
    publicPath,
    publicUrl: `${safeBaseUrl}${publicPath}`,
  };
}

function ensureStorage(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ASSET_DIR)) {
    fs.mkdirSync(ASSET_DIR, { recursive: true });
  }
}

function loadManifest(): EmailAssetRecord[] {
  ensureStorage();

  try {
    if (fs.existsSync(ASSET_MANIFEST_PATH)) {
      const content = fs.readFileSync(ASSET_MANIFEST_PATH, "utf-8");
      const parsed = JSON.parse(content) as EmailAssetRecord[];
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    return [];
  }

  return [];
}

function saveManifest(assets: EmailAssetRecord[]): void {
  ensureStorage();
  fs.writeFileSync(ASSET_MANIFEST_PATH, JSON.stringify(assets, null, 2));
}
