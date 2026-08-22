import { z } from "zod";

const emailSchema = z.email();

export function normalizeEmail(input: string): string {
  const normalized = input.trim().toLowerCase();
  return emailSchema.parse(normalized);
}

export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

export function escapeCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message
    .replace(/re_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED]")
    .slice(0, 500);
}
