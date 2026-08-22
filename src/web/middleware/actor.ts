import type { Request } from "express";
import type { ActorContext } from "../../modules/audit/service.js";
import { DomainError } from "../../shared/errors.js";

export function actorFromRequest(req: Request): ActorContext {
  if (!req.user) throw new DomainError("UNAUTHENTICATED", "Authentication is required.", 401);
  const ip = req.ip ?? "";
  const maskedIp = ip.includes(".")
    ? `${ip.split(".").slice(0, 3).join(".")}.0`
    : ip.replace(/[0-9a-f]{1,4}$/i, "0000");
  return {
    userId: req.user.id,
    role: req.user.role,
    requestId: String(req.id ?? "unknown"),
    maskedIp,
    userAgent: req.get("user-agent"),
  };
}
