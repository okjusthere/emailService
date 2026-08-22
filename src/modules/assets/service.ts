import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { AssetStorage } from "../../storage/AssetStorage.js";
import { DomainError } from "../../shared/errors.js";

export type ValidAssetKind = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
const MAX_IMAGE_PIXELS = 40_000_000;

export function detectAssetType(buffer: Buffer): ValidAssetKind | null {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}

export async function processAndStoreAsset(
  storage: AssetStorage,
  input: { buffer: Buffer; originalName: string; declaredMime: string }
) {
  const mimeType = detectAssetType(input.buffer);
  if (!mimeType || mimeType !== input.declaredMime)
    throw new DomainError(
      "UNSUPPORTED_ASSET",
      "Only valid JPEG, PNG, WebP, and PDF assets are accepted.",
      415
    );
  const isPdf = mimeType === "application/pdf";
  const max = isPdf ? 25 * 1024 * 1024 : 15 * 1024 * 1024;
  if (input.buffer.byteLength > max)
    throw new DomainError("ASSET_TOO_LARGE", `Asset exceeds the ${isPdf ? 25 : 15} MB limit.`, 413);
  const id = randomUUID();
  if (isPdf) {
    const blobName = `brochures/${id}.pdf`;
    const stored = await storage.put({ blobName, buffer: input.buffer, contentType: mimeType });
    return {
      ...stored,
      thumbnailUrl: null,
      mimeType,
      width: null,
      height: null,
      isEmailSafe: false,
    };
  }
  const image = sharp(input.buffer, {
    failOn: "warning",
    limitInputPixels: MAX_IMAGE_PIXELS,
  }).rotate();
  let metadata: Awaited<ReturnType<typeof image.metadata>>;
  try {
    metadata = await image.metadata();
  } catch {
    throw new DomainError(
      "ASSET_DIMENSIONS_TOO_LARGE",
      "The image is invalid or exceeds the safe pixel limit.",
      413
    );
  }
  if ((metadata.width ?? 0) * (metadata.height ?? 0) > MAX_IMAGE_PIXELS)
    throw new DomainError(
      "ASSET_DIMENSIONS_TOO_LARGE",
      "The image exceeds the 40 megapixel limit.",
      413
    );
  const safe = await image
    .clone()
    .resize({ width: 1200, height: 675, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const thumb = await image
    .clone()
    .resize({ width: 600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  const safeName = `images/${id}.jpg`;
  const thumbName = `images/${id}-600.jpg`;
  const [stored, thumbnail] = await Promise.all([
    storage.put({ blobName: safeName, buffer: safe, contentType: "image/jpeg" }),
    storage.put({ blobName: thumbName, buffer: thumb, contentType: "image/jpeg" }),
  ]);
  return {
    ...stored,
    thumbnailUrl: thumbnail.publicUrl,
    mimeType: "image/jpeg",
    width: Math.min(metadata.width ?? 1200, 1200),
    height: metadata.height ?? null,
    isEmailSafe: true,
  };
}
