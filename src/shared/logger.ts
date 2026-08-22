import pino from "pino";
import { config } from "../config/index.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "homix-marketing", serviceRole: config.appRole, version: "2.0.0" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.token",
      "*.apiKey",
      "*.password",
      "*.payload.to",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
