import type { RequestHandler } from "express";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../shared/logger.js";

const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Secondary audit coverage for small administrative mutations that are not
 * domain transactions. Critical mutations also write a richer audit row in
 * their transaction; this record gives every successful API mutation a common
 * request-level trail.
 */
export const mutationAudit: RequestHandler = (req, res, next) => {
  if (readMethods.has(req.method)) return next();
  res.once("finish", () => {
    if (!req.user || res.statusCode >= 400) return;
    void prisma.auditLog
      .create({
        data: {
          actorUserId: req.user.id,
          action: "http.mutation",
          entityType: "api_request",
          requestId: String(req.id ?? "unknown"),
          maskedIp: req.ip ? req.ip.replace(/\d+$/, "x") : null,
          userAgent: req.get("user-agent")?.slice(0, 500),
          after: { method: req.method, route: req.route?.path ?? req.path, status: res.statusCode },
        },
      })
      .catch((error: unknown) =>
        logger.error({ err: error, requestId: req.id }, "Mutation audit write failed")
      );
  });
  next();
};
