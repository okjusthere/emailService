import { createHash } from "node:crypto";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    // Fragments do not reach the destination server. Keep all query parameters: they
    // may identify the listing, and removing them could count a different destination.
    url.hash = "";
    url.searchParams.sort();
    return url;
  } catch {
    return null;
  }
}

export type LinkPurpose = "listing" | "unsubscribe" | "company" | "other";
export type AutomationClassification = "automated" | "unknown";

export function classifyClick(input: {
  payload: unknown;
  contentSnapshot: unknown;
  unsubscribeTokenHash: string;
  baseUrl: string;
}): { linkPurpose: LinkPurpose; automationClassification: AutomationClassification } {
  const click = object(object(input.payload).data).click;
  const details = object(click);
  const userAgent = typeof details.userAgent === "string" ? details.userAgent : "";
  // Only explicitly identifiable automation is excluded. An ordinary browser or
  // a Google image proxy is not proof that a person did or did not interact.
  const automationClassification =
    /\b(?:Googlebot|bingbot|DuckDuckBot|Baiduspider|YandexBot|facebookexternalhit|Slackbot|Twitterbot|LinkedInBot|Applebot|Bytespider|HeadlessChrome|urlscan)\b/i.test(
      userAgent
    )
      ? "automated"
      : "unknown";
  const link = normalizedUrl(details.link);
  if (!link) return { linkPurpose: "other", automationClassification };

  const base = normalizedUrl(input.baseUrl);
  const unsubscribePaths = ["/unsubscribe", "/api/public/unsubscribe/one-click"].map(
    (path) => `${base?.pathname.replace(/\/$/, "") ?? ""}${path}`
  );
  const token = link.searchParams.get("token");
  if (
    base &&
    link.origin === base.origin &&
    unsubscribePaths.includes(link.pathname) &&
    token &&
    createHash("sha256").update(token).digest("hex") === input.unsubscribeTokenHash
  ) {
    return { linkPurpose: "unsubscribe", automationClassification };
  }

  const snapshot = object(input.contentSnapshot);
  const listing = normalizedUrl(object(snapshot.content).ctaUrl);
  if (listing?.href === link.href) return { linkPurpose: "listing", automationClassification };
  const company = normalizedUrl(object(snapshot.company).website);
  if (company?.href === link.href) return { linkPurpose: "company", automationClassification };
  return { linkPurpose: "other", automationClassification };
}

export type BounceType = "Permanent" | "Transient" | "Undetermined";
export interface BounceClassification {
  type: BounceType;
  subType: string | null;
  reason: string;
  suppressionReason: "HARD_BOUNCE" | "SOFT_BOUNCE" | "BOUNCE_REVIEW";
}

function summarizeBounceDiagnostic(diagnostic: string): string | null {
  if (/mailboxfull|mailbox.{0,20}full|quota exceeded|\b[45]\.2\.2\b/i.test(diagnostic)) {
    return "The recipient mailbox is full.";
  }
  if (
    /no such user|unknown user|user unknown|invalid recipient|does not exist|\b5\.1\.1\b/i.test(
      diagnostic
    )
  ) {
    return "The recipient address could not be found.";
  }
  if (/dns|nxdomain|host not found|domain not found|name resolution/i.test(diagnostic)) {
    return "The recipient domain could not be resolved.";
  }
  if (/message.{0,20}(?:large|size)|size.{0,20}(?:exceed|limit)|\b5\.3\.4\b/i.test(diagnostic)) {
    return "The message exceeds the recipient server's size limit.";
  }
  if (/policy|spam|blocked|reject|access denied|\b5\.7\./i.test(diagnostic)) {
    return "The recipient server rejected the message under its delivery policy.";
  }
  if (/timeout|timed out|connection|connect|unreachable/i.test(diagnostic)) {
    return "Connection to the recipient server failed or timed out.";
  }
  return null;
}

export function classifyBounce(payload: unknown): BounceClassification {
  const bounce = object(object(object(payload).data).bounce);
  const rawType = typeof bounce.type === "string" ? bounce.type.trim().toLowerCase() : "";
  const type =
    rawType === "permanent" ? "Permanent" : rawType === "transient" ? "Transient" : "Undetermined";
  const subType =
    typeof bounce.subType === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(bounce.subType)
      ? bounce.subType
      : null;
  const diagnosticCodes = Array.isArray(bounce.diagnosticCode)
    ? bounce.diagnosticCode
    : [bounce.diagnosticCode];
  const diagnostic = diagnosticCodes
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 20)
    .map((entry) => entry.slice(0, 8192))
    .join("\n");
  // Provider diagnostics can contain addresses, IPs and message identifiers. Keep
  // the original only in the restricted raw event, and expose a fixed summary.
  // SMTP diagnostics are more specific than a generic provider message such as
  // "Message rejected". Neither diagnostic text nor codes are copied to the DTO.
  const reason =
    summarizeBounceDiagnostic(diagnostic) ??
    summarizeBounceDiagnostic(subType ?? "") ??
    summarizeBounceDiagnostic(
      typeof bounce.message === "string" ? bounce.message.slice(0, 8192) : ""
    ) ??
    (type === "Permanent"
      ? "Permanent delivery failure."
      : type === "Transient"
        ? "Temporary delivery failure; review required."
        : "Delivery failure type is unknown; review required.");
  return {
    type,
    subType,
    reason,
    suppressionReason:
      type === "Permanent" ? "HARD_BOUNCE" : type === "Transient" ? "SOFT_BOUNCE" : "BOUNCE_REVIEW",
  };
}

export function shouldReplaceBounceClassification(current: string | null, incoming: BounceType) {
  const severity: Record<string, number> = { Permanent: 3, Undetermined: 2, Transient: 1 };
  return severity[incoming]! > (current ? (severity[current] ?? 0) : 0);
}
