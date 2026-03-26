import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { getDatabasePath, getDb } from "../db/connection.js";
import { runMigrations } from "../db/schema.js";
import { logger } from "../utils/logger.js";

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function escapeSqlitePath(filePath: string): string {
  return filePath.replace(/'/g, "''");
}

function copyIfExists(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

async function main(): Promise<void> {
  ensureDir(config.backupDir);
  const timestamp = new Date();
  const backupName = `email-service-${formatTimestamp(timestamp)}`;
  const outputDir = path.join(config.backupDir, backupName);
  const databaseBackupPath = path.join(outputDir, "email_service.db");
  const assetsSourceDir = path.join(config.dataDir, "email-assets");
  const assetsManifestPath = path.join(config.dataDir, "email_assets.json");

  ensureDir(outputDir);
  runMigrations();

  const db = getDb();
  db.exec(`VACUUM INTO '${escapeSqlitePath(databaseBackupPath)}'`);

  copyIfExists(assetsSourceDir, path.join(outputDir, "email-assets"));
  copyIfExists(assetsManifestPath, path.join(outputDir, "email_assets.json"));

  fs.writeFileSync(
    path.join(outputDir, "metadata.json"),
    JSON.stringify(
      {
        createdAt: timestamp.toISOString(),
        dataDir: config.dataDir,
        databasePath: getDatabasePath(),
        nodeVersion: process.version,
      },
      null,
      2
    )
  );

  logger.success(`Backup created at ${outputDir}`);
}

main().catch((error) => {
  logger.error("Backup failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
