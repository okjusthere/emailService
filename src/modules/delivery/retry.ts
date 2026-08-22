export type FailureClass = "temporary" | "permanent" | "uncertain";

export function classifyProviderFailure(input: {
  status?: number;
  code?: string;
  timedOutAfterSubmit?: boolean;
}): FailureClass {
  if (input.timedOutAfterSubmit) return "uncertain";
  if (!input.status || input.status === 408 || input.status === 429 || input.status >= 500)
    return "temporary";
  if (
    ["rate_limit_exceeded", "application_error", "internal_server_error"].includes(input.code ?? "")
  )
    return "temporary";
  return "permanent";
}

export function retryDelayMs(
  attempt: number,
  retryAfterSeconds?: number,
  random = Math.random
): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  const base = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  return Math.floor(base * (0.8 + random() * 0.4));
}

export function canRetry(
  attempt: number,
  maxAttempts: number,
  expiresAt: Date,
  now = new Date()
): boolean {
  return attempt < maxAttempts && now < expiresAt;
}
