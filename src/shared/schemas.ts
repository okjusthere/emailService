import { ContactSourceType, ContactType, PermissionBasis } from "@prisma/client";
import { z } from "zod";

export const uuidSchema = z.uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  cursor: uuidSchema.optional(),
});

export const audienceFilterSchema = z
  .object({
    contactTypes: z.array(z.enum(ContactType)).max(20).optional(),
    sourceTypes: z.array(z.enum(ContactSourceType)).max(20).optional(),
    permissionBases: z.array(z.enum(PermissionBasis)).max(10).optional(),
    marketIdsAny: z.array(uuidSchema).max(100).optional(),
    propertyInterestIdsAny: z.array(uuidSchema).max(100).optional(),
    tagIdsAny: z.array(uuidSchema).max(100).optional(),
    tagIdsAll: z.array(uuidSchema).max(100).optional(),
    excludeTagIds: z.array(uuidSchema).max(100).optional(),
    engagedWithinDays: z.number().int().min(1).max(3650).nullable().optional(),
    createdAfter: z.iso.datetime().nullable().optional(),
    includeContactIds: z.array(uuidSchema).max(1000).optional(),
    excludeContactIds: z.array(uuidSchema).max(1000).optional(),
    excludePreviouslySentListing: z.boolean().optional(),
    requireKnownPermissionBasis: z.boolean().default(true),
  })
  .strict();

export type AudienceFilter = z.infer<typeof audienceFilterSchema>;

export const contactInputSchema = z.object({
  email: z.email(),
  firstName: z.string().trim().max(100).nullable().optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  displayName: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  jobTitle: z.string().trim().max(150).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  contactType: z.enum(ContactType).default("OTHER"),
  sourceType: z.enum(ContactSourceType),
  sourceDetail: z.string().trim().max(500).nullable().optional(),
  permissionBasis: z.enum(PermissionBasis).default("UNKNOWN"),
  notes: z.string().max(5000).nullable().optional(),
  tagIds: z.array(uuidSchema).max(100).optional(),
  marketIds: z.array(uuidSchema).max(100).optional(),
  propertyInterestIds: z.array(uuidSchema).max(100).optional(),
});

export const campaignActionSchema = z.object({
  version: z.number().int().min(1),
  scheduledAt: z.iso.datetime().optional(),
});
