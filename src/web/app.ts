import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import pinoHttpModule from "pino-http";
import type { RequestHandler } from "express";
import { config } from "../config/index.js";
import { checkDatabase } from "../db/prisma.js";
import { logger } from "../shared/logger.js";
import { errorHandler } from "../shared/errors.js";
import { authenticate } from "./middleware/auth.js";
import { requireCsrf } from "./middleware/csrf.js";
import { requestContext } from "./middleware/requestContext.js";
import { mutationAudit } from "./middleware/mutationAudit.js";
import { localDevLoginRouter, v2Router, assetStorage } from "./routes/v2.js";
import { publicRouter } from "./routes/public.js";

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
}

interface LoggedResponse {
  statusCode?: number;
}

export function serializeHttpRequest(req: LoggedRequest) {
  return {
    id: String(req.id ?? "unknown"),
    method: req.method ?? "UNKNOWN",
    path: (req.url ?? "/").split("?", 1)[0],
  };
}

export function serializeHttpResponse(res: LoggedResponse) {
  return { statusCode: res.statusCode ?? 0 };
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestContext);
  const pinoHttp = pinoHttpModule as unknown as (options: {
    logger: typeof logger;
    customProps: (req: { id?: unknown }) => object;
    serializers: { req: typeof serializeHttpRequest; res: typeof serializeHttpResponse };
  }) => RequestHandler;
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: String(req.id ?? "unknown") }),
      serializers: { req: serializeHttpRequest, res: serializeHttpResponse },
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          frameSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.post("/api/public/webhooks/resend", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok", role: config.appRole, version: "2.0.0", commitSha: config.commitSha });
  });
  app.get("/health/ready", async (_req, res) => {
    try {
      await Promise.all([checkDatabase(), assetStorage.checkReady()]);
      res.json({ status: "ready", role: config.appRole, version: "2.0.0" });
    } catch {
      res.status(503).json({ status: "not_ready", role: config.appRole, version: "2.0.0" });
    }
  });
  app.use("/api/public", publicRouter);
  app.get("/unsubscribe", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const safeToken = token.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 1000);
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:system-ui;max-width:560px;margin:80px auto;padding:24px"><h1>Stop marketing emails?</h1><p>Confirm below. Opening this page alone does not unsubscribe you.</p><form method="post" action="/api/public/unsubscribe/confirm"><input type="hidden" name="token" value="${safeToken}"><button style="padding:12px 18px">Confirm unsubscribe</button></form></body></html>`
      );
  });

  if (config.storageProvider === "local")
    app.use(
      "/public/assets",
      express.static(config.localAssetDir, {
        immutable: true,
        maxAge: "1y",
        setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
      })
    );
  app.use(
    "/api/v2",
    rateLimit({ windowMs: 15 * 60_000, limit: 2_000, standardHeaders: true, legacyHeaders: false })
  );
  app.use("/api/v2", requireCsrf, localDevLoginRouter);
  app.use("/api/v2", authenticate, requireCsrf, mutationAudit, v2Router);

  const clientDir = path.join(process.cwd(), "dist", "client");
  app.use(
    express.static(clientDir, {
      index: false,
      immutable: true,
      maxAge: "1y",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
      },
    })
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "API route not found.",
        details: {},
        requestId: "unknown",
      },
    });
  });
  app.get("*splat", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(clientDir, "index.html"));
  });
  app.use(errorHandler);
  return app;
}
