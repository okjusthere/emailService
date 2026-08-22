import type { ErrorRequestHandler, Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logger } from "./logger.js";

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requestId(request: Request): string {
  return String(request.id ?? "unknown");
}

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred.";
  let details: Record<string, unknown> = {};

  if (error instanceof DomainError) {
    ({ status, code, message, details } = error);
  } else if (error instanceof z.ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Request validation failed.";
    details = { issues: error.issues };
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    status = 409;
    code = "DUPLICATE_RESOURCE";
    message = "A resource with that unique value already exists.";
  } else {
    logger.error({ err: error, requestId: requestId(req) }, "Unhandled request error");
  }

  res.status(status).json({ error: { code, message, details, requestId: requestId(req) } });
};
