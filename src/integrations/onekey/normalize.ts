import { z } from "zod";
import type { OneKeyListing } from "./types.js";

const listingSchema = z
  .object({
    listingKey: z.string().min(1).max(255),
    listingId: z.string().optional(),
    standardStatus: z.string().optional(),
    unparsedAddress: z.string().default("Address unavailable"),
    city: z.string().default("Unknown"),
    stateOrProvince: z.string().default("NY"),
    postalCode: z.string().default("00000"),
    countyOrParish: z.string().optional(),
    propertyType: z.string().optional(),
    propertySubType: z.string().optional(),
    listPrice: z.number().nonnegative().optional(),
    bedroomsTotal: z.number().int().nonnegative().optional(),
    bathroomsTotalInteger: z.number().int().nonnegative().optional(),
    livingArea: z.number().nonnegative().optional(),
    yearBuilt: z.number().int().min(1600).max(2200).optional(),
    publicRemarks: z.string().max(50_000).optional(),
    listAgentFullName: z.string().optional(),
    listOfficeName: z.string().optional(),
    modificationTimestamp: z.string().optional(),
    imageUrls: z
      .array(
        z.url().refine((value) => new URL(value).protocol === "https:", "Media URL must use HTTPS")
      )
      .max(100)
      .default([]),
  })
  .passthrough();

export function normalizeOneKeyListing(value: unknown): OneKeyListing {
  const item = listingSchema.parse(value);
  const state = item.stateOrProvince.trim().toUpperCase();
  return {
    sourceKey: item.listingKey,
    listingId: item.listingId,
    standardStatus: item.standardStatus,
    unparsedAddress: item.unparsedAddress,
    city: item.city,
    stateCode: state === "NEW YORK" ? "NY" : state.slice(0, 2),
    postalCode: item.postalCode,
    county: item.countyOrParish,
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
    imageUrls: item.imageUrls,
    raw: item,
  };
}

export function normalizeAddress(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
