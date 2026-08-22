import type { RequestHandler } from "express";
import { config } from "../../config/index.js";
import { DomainError } from "../../shared/errors.js";

export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const originHeader = req.get("origin") ?? req.get("referer") ?? "";
  let origin = "";
  try {
    origin = new URL(originHeader).origin;
  } catch {
    origin = "";
  }
  if (req.get("x-homix-csrf") !== "1" || origin !== new URL(config.baseUrl).origin) {
    return next(
      new DomainError("CSRF_REJECTED", "Mutation request failed same-origin verification.", 403)
    );
  }
  next();
};
