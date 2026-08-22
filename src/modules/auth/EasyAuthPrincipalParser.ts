import { z } from "zod";

const claimSchema = z.object({ typ: z.string(), val: z.string() });
const principalSchema = z.object({
  auth_typ: z.string().optional(),
  name_typ: z.string().optional(),
  role_typ: z.string().optional(),
  claims: z.array(claimSchema),
});

export interface EasyAuthIdentity {
  objectId: string;
  email: string;
  displayName: string | null;
}

export function parseEasyAuthPrincipal(encoded: string): EasyAuthIdentity {
  const raw = Buffer.from(encoded, "base64").toString("utf8");
  const principal = principalSchema.parse(JSON.parse(raw) as unknown);
  const values = new Map(principal.claims.map((claim) => [claim.typ.toLowerCase(), claim.val]));
  const find = (...keys: string[]) =>
    keys.map((key) => values.get(key.toLowerCase())).find(Boolean);
  const objectId =
    find("http://schemas.microsoft.com/identity/claims/objectidentifier", "oid") ?? "";
  const email =
    find(
      "preferred_username",
      "emails",
      "email",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn"
    )
      ?.trim()
      .toLowerCase() ?? "";
  const displayName =
    find("name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ?? null;
  if (!objectId || !z.email().safeParse(email).success)
    throw new Error("Easy Auth principal lacks a valid object ID or email");
  return { objectId, email, displayName };
}
