import { config } from "./config/index.js";
import { runMigrations } from "./migrate.js";
import { logger } from "./shared/logger.js";
import { startWebServer } from "./web/server.js";
import { startWorker } from "./worker/worker.js";

async function main(): Promise<void> {
  switch (config.appRole) {
    case "web":
      await startWebServer();
      return;
    case "worker":
      await startWorker();
      return;
    case "migrate":
      await runMigrations();
      return;
  }
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Process failed");
  process.exitCode = 1;
});
