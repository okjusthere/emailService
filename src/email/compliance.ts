import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { DomainError } from "../shared/errors.js";

export function sanitizeIntro(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "em", "ul", "ol", "li", "a"],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["https"],
    disallowedTagsMode: "discard",
  });
}

export function createUnsubscribeToken(recipientId: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(recipientId).digest("base64url");
  return Buffer.from(`${recipientId}.${signature}`).toString("base64url");
}

export function hashUnsubscribeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [recipientId, signature] = decoded.split(".");
    if (!recipientId || !signature) return null;
    const expected = createHmac("sha256", secret).update(recipientId).digest();
    const actual = Buffer.from(signature, "base64url");
    return expected.length === actual.length && timingSafeEqual(expected, actual)
      ? recipientId
      : null;
  } catch {
    return null;
  }
}

export function verifyUnsubscribeTokenWithRotation(
  token: string,
  currentSecret: string,
  previousSecret?: string,
  previousExpiresAt?: string
): string | null {
  const current = verifyUnsubscribeToken(token, currentSecret);
  if (current) return current;
  if (!previousSecret || !previousExpiresAt) return null;
  const expiry = Date.parse(previousExpiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return null;
  return verifyUnsubscribeToken(token, previousSecret);
}

export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

export function validateRenderedEmail(input: {
  subject: string;
  html: string;
  text: string;
  companyAddress: string;
  live: boolean;
}): void {
  if (!input.subject.trim() || input.subject.length > 150 || /[\r\n]/.test(input.subject))
    throw new DomainError("INVALID_SUBJECT", "Subject must be 1–150 characters without newlines.");
  if (!input.text.trim())
    throw new DomainError("EMPTY_PLAIN_TEXT", "Plain-text email content is required.");
  if (!input.companyAddress.trim() || /REQUIRED|PLACEHOLDER/i.test(input.companyAddress))
    throw new DomainError("COMPANY_ADDRESS_REQUIRED", "A real company postal address is required.");
  if (
    !/unsubscribe/i.test(input.html) ||
    /javascript:/i.test(input.html) ||
    /\{\{[^}]+\}\}/.test(input.html)
  )
    throw new DomainError("INVALID_EMAIL_CONTENT", "Email content failed compliance validation.");
  if (input.live && /(?:localhost|127\.0\.0\.1)/i.test(input.html))
    throw new DomainError("LOCAL_URL_IN_LIVE_EMAIL", "Live email cannot contain local URLs.");
}
