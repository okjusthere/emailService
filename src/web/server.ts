import type { Server } from "node:http";
import { config } from "../config/index.js";
import { closePrisma } from "../db/prisma.js";
import { logger } from "../shared/logger.js";
import { createApp } from "./app.js";

export async function startWebServer(): Promise<void> {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const value = app.listen(config.port, () => resolve(value));
  });
  logger.info({ port: config.port }, "Web server started");
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logger.info("Web shutdown requested");
    const deadline = setTimeout(() => process.exit(1), 25_000).unref();
    server.close(() => {
      clearTimeout(deadline);
      void closePrisma().finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
