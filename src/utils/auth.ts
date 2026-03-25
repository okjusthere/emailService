import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Middleware to protect API endpoints with a secret key.
 * Requests must include the header: `x-api-secret: <your-secret>`
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiSecret) {
    res.status(500).json({ error: "API_SECRET not configured on server" });
    return;
  }

  const provided = req.headers["x-api-secret"] as string;

  if (!provided || provided !== config.apiSecret) {
    res.status(401).json({ error: "Unauthorized — invalid or missing x-api-secret header" });
    return;
  }

  next();
}
