export interface OneKeyMediaPolicy {
  nodeEnv: "development" | "test" | "production";
  provider: "disabled" | "bbo" | "fake";
  bboListingApiBaseUrl: string;
  allowedOrigins: readonly string[];
}

export function isAllowedOneKeyMediaUrl(raw: string, policy: OneKeyMediaPolicy) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(policy.nodeEnv !== "production" && url.protocol === "http:"))
      return false;
    if (policy.provider !== "bbo") return policy.nodeEnv !== "production";
    const approvedOrigins = new Set([
      new URL(policy.bboListingApiBaseUrl).origin,
      ...policy.allowedOrigins,
    ]);
    return approvedOrigins.has(url.origin);
  } catch {
    return false;
  }
}
