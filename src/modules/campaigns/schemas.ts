import { CampaignTemplateKey } from "@prisma/client";
import { z } from "zod";
import { audienceFilterSchema } from "../../shared/schemas.js";

const safeUrl = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}, "CTA URL must use HTTPS");

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  listingId: z.uuid(),
  senderProfileId: z.uuid(),
  replyToAgentId: z.uuid().nullable().optional(),
  savedAudienceId: z.uuid().nullable().optional(),
  templateKey: z.enum(CampaignTemplateKey),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .refine((value) => !/[\r\n]/.test(value), "Subject cannot contain newlines"),
  preheader: z.string().trim().max(200).nullable().optional(),
  introHtml: z.string().max(10000).nullable().optional(),
  introText: z.string().max(5000).nullable().optional(),
  ctaLabel: z.string().trim().min(1).max(80).default("View Listing"),
  ctaUrl: safeUrl.nullable().optional(),
  audienceFilter: audienceFilterSchema,
  timezone: z.string().default("America/New_York"),
});

export const testSendSchema = z.object({ email: z.email(), version: z.number().int().positive() });
