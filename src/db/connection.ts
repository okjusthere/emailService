import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = config.databasePath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    logger.info(`Database connected: ${dbPath}`);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
    logger.info("Database connection closed");
  }
}

export function getDatabasePath(): string {
  return config.databasePath;
}
