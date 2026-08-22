import { ListingStatus, PropertyType, TransactionType } from "@prisma/client";
import { z } from "zod";

const localOrHttpsUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}, "URL must use HTTPS");

const listingObjectSchema = z.object({
  internalName: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(160),
  status: z.enum(ListingStatus).default("DRAFT"),
  transactionType: z.enum(TransactionType),
  propertyType: z.enum(PropertyType),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  stateCode: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase()),
  postalCode: z.string().trim().min(5).max(12),
  county: z.string().trim().max(100).nullable().optional(),
  askingPrice: z
    .string()
    .regex(/^\d+(?:\.\d{1,2})?$/)
    .nullable()
    .optional(),
  priceUponRequest: z.boolean().default(false),
  askingRentText: z.string().trim().max(100).nullable().optional(),
  buildingSqFt: z.number().int().positive().nullable().optional(),
  lotSqFt: z
    .string()
    .regex(/^\d+(?:\.\d{1,2})?$/)
    .nullable()
    .optional(),
  shortDescription: z.string().max(1000).nullable().optional(),
  longDescription: z.string().max(10000).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(250)).max(20).default([]),
  listingUrl: localOrHttpsUrl.nullable().optional(),
  brochureUrl: localOrHttpsUrl.nullable().optional(),
  virtualTourUrl: localOrHttpsUrl.nullable().optional(),
  isExclusive: z.boolean().default(false),
  agentId: z.uuid(),
});

export const listingInputSchema = listingObjectSchema.refine(
  (data) =>
    data.transactionType !== "FOR_SALE" || Boolean(data.askingPrice || data.priceUponRequest),
  { path: ["askingPrice"], message: "For-sale listings require a price or price-upon-request" }
);

export const listingUpdateSchema = listingObjectSchema.partial();
