import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({ email: z.email(), exp: z.number().int() });

export function createLocalSession(email: string, secret: string, ttlSeconds = 43_200): string {
  const payload = Buffer.from(
    JSON.stringify({ email: email.toLowerCase(), exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyLocalSession(token: string, secret: string): { email: string } | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = payloadSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown
    );
    return parsed.exp > Math.floor(Date.now() / 1000)
      ? { email: parsed.email.toLowerCase() }
      : null;
  } catch {
    return null;
  }
}
