import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DomainError } from "../../shared/errors.js";

export const portalBrandSchema = z.object({
  agentId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  email: z.email(),
  phone: z.string().max(80),
  title: z.string().max(200),
  licenseNumber: z.string().max(100),
  companyId: z.string().min(1).max(100),
  companyName: z.string().min(1).max(200),
  photoUrl: z.url().nullable(),
});
const claimsSchema = z.object({
  iss: z.literal("homixliving"),
  aud: z.literal("email-service"),
  sub: z.string().regex(/^[1-9][0-9]*$/),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.uuid(),
  admin: z.boolean(),
  email: z.email(),
  brand: portalBrandSchema,
  method: z.enum(["GET", "POST", "PATCH"]),
  path: z.string(),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PortalClaims = z.infer<typeof claimsSchema>;
export const marketingIdentitySchema = portalBrandSchema.extend({
  companyAddress: z.string().min(1).max(500),
  companyWebsite: z.url(),
});
export type PortalCampaignContext = {
  sourceApplication: "homixliving";
  portalOwnerAgentId: number;
  marketingIdentity: z.infer<typeof marketingIdentitySchema>;
  senderProfileId: string;
};

export function verifyPortalToken(
  token: string,
  secret: string,
  request: { method: string; path: string; body: string },
  now = Math.floor(Date.now() / 1000)
): PortalClaims {
  const reject = () =>
    new DomainError("INVALID_PORTAL_TOKEN", "Portal authentication is invalid or expired.", 401);
  if (secret.length < 32 || token.length > 12000) throw reject();
  const parts = token.split(".");
  if (parts.length !== 3) throw reject();
  const [header, body, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw reject();
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString());
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") throw reject();
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    if (
      claims.iat > now + 10 ||
      claims.exp <= now ||
      claims.exp - claims.iat > 90 ||
      claims.exp <= claims.iat ||
      claims.iat < now - 100 ||
      claims.sub !== String(claims.brand.agentId) ||
      claims.email.toLowerCase() !== claims.brand.email.toLowerCase() ||
      claims.method !== request.method ||
      claims.path !== request.path ||
      claims.bodyHash !== createHash("sha256").update(request.body).digest("hex")
    )
      throw reject();
    return claims;
  } catch {
    throw reject();
  }
}

export function campaignPortalIdentity(campaign: {
  sourceApplication?: string | null;
  portalOwnerAgentId?: number | null;
  marketingIdentity?: unknown;
}) {
  if (campaign.sourceApplication !== "homixliving") return null;
  const parsed = marketingIdentitySchema.safeParse(campaign.marketingIdentity);
  if (!parsed.success || parsed.data.agentId !== campaign.portalOwnerAgentId)
    throw new DomainError(
      "PORTAL_IDENTITY_INVALID",
      "Campaign marketing identity must be repaired before sending.",
      409
    );
  return parsed.data;
}
