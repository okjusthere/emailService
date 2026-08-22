import { closePrisma } from "../db/prisma.js";
import { logger } from "../shared/logger.js";
import { JobRunner } from "./jobRunner.js";

export async function startWorker(): Promise<void> {
  const runner = new JobRunner();
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logger.info("Worker shutdown requested");
    runner.stop();
    setTimeout(() => process.exit(1), 25_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await runner.run();
  await closePrisma();
}
