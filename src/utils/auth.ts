import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import {
  createAdminSessionRecord,
  deleteAdminSessionToken,
  hasValidAdminSessionToken,
} from "../services/runtimeStateService.js";

const ADMIN_SESSION_COOKIE = "email_admin_session";

interface CookieOptions {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((cookies, part) => {
    const [key, ...valueParts] = part.trim().split("=");
    if (!key) {
      return cookies;
    }

    cookies[key] = decodeURIComponent(valueParts.join("="));
    return cookies;
  }, {});
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);

  if (typeof options.maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function getHeaderSecret(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return value || "";
}

function getSessionToken(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[ADMIN_SESSION_COOKIE];
}

function isTimingSafeEqual(value: string, expected: string): boolean {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

export function isValidApiSecret(secret: string): boolean {
  if (!config.apiSecret || !secret) {
    return false;
  }

  return isTimingSafeEqual(secret, config.apiSecret);
}

export function createAdminSession(res: Response): void {
  const ttlMs = config.adminSessionTtlHours * 60 * 60 * 1000;
  const { token } = createAdminSessionRecord(config.adminSessionTtlHours);

  res.setHeader("Cache-Control", "no-store");
  res.append(
    "Set-Cookie",
    serializeCookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      maxAge: ttlMs / 1000,
      path: "/api/admin",
      sameSite: "Strict",
      secure: config.nodeEnv === "production",
    })
  );
}

export function clearAdminSession(req: Request, res: Response): void {
  const token = getSessionToken(req);
  if (token) {
    deleteAdminSessionToken(token);
  }

  res.setHeader("Cache-Control", "no-store");
  res.append(
    "Set-Cookie",
    serializeCookie(ADMIN_SESSION_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/api/admin",
      sameSite: "Strict",
      secure: config.nodeEnv === "production",
    })
  );
}

function hasValidAdminSession(req: Request): boolean {
  const token = getSessionToken(req);
  if (!token) {
    return false;
  }

  return hasValidAdminSessionToken(token);
}

/**
 * Middleware to protect admin API endpoints.
 * Browser sessions authenticate via an HTTP-only cookie.
 * Scripted clients can still use `x-api-secret`.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const provided = getHeaderSecret(req.headers["x-api-secret"]);

  if (!hasValidAdminSession(req) && !isValidApiSecret(provided)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
