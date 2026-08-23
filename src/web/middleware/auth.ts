import type { RequestHandler } from "express";
import { config } from "../../config/index.js";
import { DomainError } from "../../shared/errors.js";
import { parseEasyAuthPrincipal } from "../../modules/auth/EasyAuthPrincipalParser.js";
import { resolveAzureUser, resolveLocalUser } from "../../modules/auth/service.js";
import { verifyLocalSession } from "../../modules/auth/session.js";

function readSessionCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== "homix_session") continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return "";
    }
  }
  return "";
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const user =
      config.authMode === "azure-easyauth"
        ? await resolveAzureUser(parseEasyAuthPrincipal(req.get("x-ms-client-principal") ?? ""))
        : await resolveLocalUser(
            verifyLocalSession(readSessionCookie(req.get("cookie")), config.sessionSecret)?.email ??
              ""
          );
    req.user = { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
    next();
  } catch (error) {
    next(
      error instanceof DomainError
        ? error
        : new DomainError("UNAUTHENTICATED", "Authentication is required.", 401)
    );
  }
};

export function requireRole(...roles: Array<"ADMIN" | "MARKETER" | "VIEWER">): RequestHandler {
  return (req, _res, next) => {
    if (!req.user)
      return next(new DomainError("UNAUTHENTICATED", "Authentication is required.", 401));
    if (!roles.includes(req.user.role))
      return next(
        new DomainError("FORBIDDEN", "You do not have permission for this operation.", 403)
      );
    next();
  };
}
